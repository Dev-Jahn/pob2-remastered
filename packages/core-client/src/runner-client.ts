/**
 * RunnerClient — the low-level transport that spawns and drives the Lua runner
 * subprocess (overlays/lua/runner.lua) over newline-delimited JSON-RPC 2.0
 * (DESIGN §5.1 "JSON-RPC schema validation", §6.2 out-of-process runner).
 *
 * Responsibilities (everything BELOW the typed Core API surface in index.ts):
 *   - subprocess lifecycle: spawn under LuaJIT, ready handshake on core.version,
 *     kill on dispose (DESIGN §14.2 crash isolation);
 *   - NDJSON framing: one JSON request per line out, exactly one JSON line per
 *     response in, correlated by JSON-RPC `id`;
 *   - schema validation: every request validated against the registry request
 *     schema BEFORE send and every assembled response validated against the
 *     registry response schema AFTER receive — a schema-invalid response is
 *     surfaced as a CoreError, never passed through (DESIGN §6.4);
 *   - dead / timed-out runner -> CORE_INIT_FAILED CoreError rather than hanging.
 *
 * The runner self-re-execs under LuaJIT when started on PUC Lua 5.1, but spawning
 * `luajit` directly skips that hop and is the same interpreter the Lua specs use.
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import {
  schemaRegistry,
  CORE_ERROR_CODES,
  type CoreError,
  type CoreErrorCode,
  type MvpMethod,
} from '@pob2/schema';

// Resolve repo-root paths from THIS module's location so the client works from
// any cwd (the runner itself resolves vendor via an absolute self-path, so cwd
// only matters for finding the runner script).
const here = dirname(fileURLToPath(import.meta.url));
// packages/core-client/src -> repo root
const REPO_ROOT = resolve(here, '..', '..', '..');
const RUNNER_PATH = resolve(REPO_ROOT, 'overlays/lua/runner.lua');

/** Typed error carrying the normalised CoreError envelope (DESIGN §6.4). */
export class CoreClientError extends Error {
  readonly code: CoreErrorCode;
  readonly details?: unknown;
  readonly upstreamStack?: string;
  /**
   * The raw JSON-RPC error code, when the failure originated as a protocol-level
   * fault (parse error -32700, method not found -32601, …) rather than a core
   * application error. Preserved alongside the normalised CoreError `code` so the
   * crash-isolation gate can distinguish a malformed-protocol rejection from a
   * core CoreError (DESIGN §14.2). Undefined for purely client-side errors.
   */
  readonly jsonRpcCode?: number;

  constructor(error: CoreError, jsonRpcCode?: number) {
    super(error.message);
    this.name = 'CoreClientError';
    this.code = error.code;
    this.details = error.details;
    this.upstreamStack = error.upstreamStack;
    this.jsonRpcCode = jsonRpcCode;
  }

  toCoreError(): CoreError {
    const out: CoreError = { code: this.code, message: this.message };
    if (this.details !== undefined) out.details = this.details;
    if (this.upstreamStack !== undefined) out.upstreamStack = this.upstreamStack;
    return out;
  }
}

/** Build a CoreClientError, preserving the closed CoreError code set. */
function coreError(
  code: CoreErrorCode,
  message: string,
  details?: unknown,
  upstreamStack?: string,
): CoreClientError {
  return new CoreClientError({ code, message, details, upstreamStack });
}

export interface RunnerClientOptions {
  /** Absolute path to runner.lua; defaults to the in-repo overlay. */
  runnerPath?: string;
  /** LuaJIT interpreter to spawn the runner under. */
  luajit?: string;
  /** Per-request timeout (ms) before a CORE_INIT_FAILED is raised. */
  requestTimeoutMs?: number;
  /** Handshake timeout (ms) for the initial core.version exchange. */
  readyTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: CoreClientError) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: { code?: unknown } };
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_READY_TIMEOUT_MS = 30_000;

// JSON-RPC application-error code the runner emits for a modern_api CoreError;
// its `data.code` carries the typed CoreError code (DESIGN §6.4 round-trips it).
const RPC_SERVER_ERROR = -32000;
const RPC_PARSE_ERROR = -32700;

/**
 * Max byte length of a single raw line written to the runner over stdin (DESIGN
 * §14.2 "share code decode는 size limit 적용", and crash-isolation: a hostile
 * oversized frame must never be buffered/decoded whole). Lines beyond this are
 * refused as a protocol fault both client-side (here) and runner-side (runner.lua
 * applies the same cap independently — defence in depth). 1 MiB comfortably holds
 * any real build XML/share-code frame while bounding a single allocation.
 */
export const RAW_REQUEST_MAX_BYTES = 1024 * 1024;

/**
 * Max byte length of a PoB share code accepted by loadShareCode before decode
 * (DESIGN §14.2 share-code decode size limit). A code beyond this is rejected with
 * BUILD_PARSE_FAILED BEFORE inflate, so a hostile (e.g. zip-bomb-shaped) code can
 * never reach the decompressor. A real build share code is well under this.
 */
export const SHARE_CODE_MAX_BYTES = 512 * 1024;

/** Map a runner JSON-RPC error frame to a typed CoreError code. */
function rpcErrorToCode(err: NonNullable<JsonRpcResponse['error']>): CoreErrorCode {
  const data = err.data;
  const candidate = data && typeof data.code === 'string' ? data.code : undefined;
  if (candidate && (CORE_ERROR_CODES as readonly string[]).includes(candidate)) {
    return candidate as CoreErrorCode;
  }
  // -32000 is the core's own application error; anything else is a protocol-level
  // fault (parse / invalid request / method-not-found) which, for a method the
  // client itself issues, can only mean the core surface is incompatible.
  return err.code === RPC_SERVER_ERROR ? 'CALC_FAILED' : 'UPSTREAM_INCOMPATIBLE';
}

/** Build a CoreClientError from a runner JSON-RPC error frame, keeping its code. */
function fromRpcError(err: NonNullable<JsonRpcResponse['error']>): CoreClientError {
  return new CoreClientError(
    { code: rpcErrorToCode(err), message: err.message ?? 'runner error' },
    typeof err.code === 'number' ? err.code : undefined,
  );
}

/**
 * Resolve the luarocks `--local` Lua module search paths and merge them into the
 * child environment so the runner can `require('lua-utf8')` (a native .so the
 * vendored core needs; see overlays/lua/README.md "Provision lua-utf8"). Absent
 * luarocks, the parent env is used unchanged — a missing module then surfaces as
 * a per-build CORE_INIT_FAILED rather than a silent wrong answer.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const read = (flag: string): string | undefined => {
    const r = spawnSync('luarocks', ['--local', 'path', flag], { encoding: 'utf8' });
    if (r.status !== 0 || typeof r.stdout !== 'string') return undefined;
    const value = r.stdout.trim();
    return value.length > 0 ? value : undefined;
  };
  const lrPath = read('--lr-path');
  const lrCpath = read('--lr-cpath');
  if (lrPath) env.LUA_PATH = `${lrPath};${env.LUA_PATH ?? ';;'}`;
  if (lrCpath) env.LUA_CPATH = `${lrCpath};${env.LUA_CPATH ?? ';;'}`;
  return env;
}

/**
 * Low-level driver over the runner subprocess. One instance owns one runner
 * process. Not concurrency-safe in the sense of pipelining out-of-order: the
 * runner answers in order, but responses are correlated by `id` so awaiting
 * methods in parallel is still well-defined.
 */
export class RunnerClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private readline: Interface | undefined;
  private readonly pending = new Map<number, PendingRequest>();
  /**
   * In-flight request ids in send order. The runner answers strictly in order, so
   * a response with no usable id (a -32700 parse-error frame, which dkjson emits
   * with id=null because the offending line never parsed) belongs to the OLDEST
   * outstanding request — the head of this queue. Without this a malformed line
   * sent via sendRaw would hang until timeout (DESIGN §14.2 "no hang").
   */
  private readonly pendingOrder: number[] = [];
  private nextId = 1;
  private disposed = false;
  /** Set when the process dies; every later request rejects with this. */
  private deadError: CoreClientError | undefined;

  private readonly luajit: string;
  private readonly runnerPath: string;
  private readonly requestTimeoutMs: number;
  private readonly readyTimeoutMs: number;

  private readonly validators = new Map<string, ValidateFunction>();
  private readonly ajv = new Ajv2020({ allErrors: true, strict: false });

  constructor(options: RunnerClientOptions = {}) {
    this.luajit = options.luajit ?? 'luajit';
    this.runnerPath = options.runnerPath ?? RUNNER_PATH;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  }

  /**
   * Spawn the runner and complete the core.version ready handshake. Resolves only
   * once the runner has answered core.version; a spawn failure, an early exit, or
   * a handshake timeout becomes a CORE_INIT_FAILED CoreError (never a hang).
   */
  async start(): Promise<void> {
    if (this.child) throw coreError('CORE_INIT_FAILED', 'runner already started');

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.luajit, [this.runnerPath], {
        cwd: REPO_ROOT,
        env: childEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      throw coreError('CORE_INIT_FAILED', `failed to spawn runner: ${String(e)}`);
    }
    this.child = child;

    // A spawn error (e.g. luajit not on PATH) arrives async on the 'error' event;
    // fail every in-flight + future request with it rather than hanging.
    child.on('error', (e) => {
      this.markDead(coreError('CORE_INIT_FAILED', `runner process error: ${e.message}`));
    });
    // The runner narrates core boot/calc on stderr by design; surface it only as
    // diagnostic context attached to a dead-process error, never on the happy path.
    const stderrChunks: string[] = [];
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrChunks.push(chunk);
      if (stderrChunks.length > 200) stderrChunks.shift();
    });
    child.on('exit', (code, signal) => {
      if (this.disposed) return;
      const why = signal ? `signal ${signal}` : `code ${code}`;
      this.markDead(
        coreError(
          'CORE_INIT_FAILED',
          `runner exited unexpectedly (${why})`,
          undefined,
          stderrChunks.join('').slice(-4000) || undefined,
        ),
      );
    });

    this.readline = createInterface({ input: child.stdout });
    this.readline.on('line', (line) => this.onLine(line));

    // Ready handshake: block until core.version answers (DESIGN §6.3).
    const version = (await this.call('core.version', {}, this.readyTimeoutMs)) as {
      version?: unknown;
    };
    if (!version || typeof version.version !== 'string' || version.version.length === 0) {
      const err = coreError(
        'CORE_INIT_FAILED',
        'runner core.version handshake returned no version',
      );
      this.markDead(err);
      await this.dispose();
      throw err;
    }
  }

  /**
   * Send a typed Core API request and return its validated response. Validates
   * `params` against the registry request schema before send and the assembled
   * response against the registry response schema after receive; either failure
   * is an UPSTREAM_INCOMPATIBLE CoreError (DESIGN §6.4 "schema-invalid response is
   * surfaced as a CoreError, never passed through").
   *
   * `wire` adapts the typed Core API params to the runner's positional wire
   * params, and `assemble` lifts the runner's wire result back into the typed
   * Core API response shape (the runner and the registry are not byte-identical).
   *
   * `opts.validateResponse` may be set false ONLY where the headless runner cannot
   * yet express the registry response shape (build.load's BuildState — see
   * index.ts). The request is always validated; skipping response validation is a
   * documented gap, never a silent fallthrough.
   */
  async request<M extends MvpMethod>(
    method: M,
    params: unknown,
    wire: (params: unknown) => Record<string, unknown>,
    assemble: (wireResult: unknown) => unknown,
    opts: { validateResponse?: boolean } = {},
  ): Promise<unknown> {
    this.validateRequest(method, params);
    const wireResult = await this.call(method, wire(params), this.requestTimeoutMs);
    const response = assemble(wireResult);
    if (opts.validateResponse !== false) this.validateResponse(method, response);
    return response;
  }

  /** The OS pid of the live runner process, or undefined once it has exited. */
  get pid(): number | undefined {
    return this.child?.pid;
  }

  /** Raw JSON-RPC call by method name with already-wire-shaped params. */
  async call(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++;
    const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return this.writeFrame(id, frame, timeoutMs, `request '${method}'`);
  }

  /**
   * Write an ARBITRARY raw line to the runner — including deliberately malformed
   * input (non-JSON, truncated, oversized) — and settle on the runner's reply.
   * Used by the crash-isolation gate to prove the runner answers a hostile line
   * with a structured JSON-RPC error and keeps running (DESIGN §14.2). The line is
   * still id-tracked in send order, so a -32700 parse-error frame (which carries no
   * id) is correlated back to this call rather than hanging. An oversized line is
   * refused here without writing it, mirroring the runner's own cap (defence in
   * depth) — the rejection still flows through the in-order pending queue.
   */
  async sendRaw(line: string, timeoutMs = this.requestTimeoutMs): Promise<unknown> {
    const id = this.nextId++;
    // A line that exceeds the cap is a protocol fault by definition; surface it as
    // the runner would (-32700) without ever putting it on the wire.
    if (Buffer.byteLength(line, 'utf8') > RAW_REQUEST_MAX_BYTES) {
      throw new CoreClientError(
        {
          code: 'UPSTREAM_INCOMPATIBLE',
          message: `raw line exceeds the ${RAW_REQUEST_MAX_BYTES}-byte runner input limit`,
        },
        RPC_PARSE_ERROR,
      );
    }
    return this.writeFrame(id, line.replace(/\n/g, ' ') + '\n', timeoutMs, 'raw line');
  }

  /**
   * Register an in-flight request (pending map + in-order queue) under `id`, write
   * its frame, and return a promise that the matching response settles. A timeout
   * tears the runner down (a wedged runner cannot recover); a write error rejects
   * just this call.
   */
  private writeFrame(
    id: number,
    frame: string,
    timeoutMs: number,
    label: string,
  ): Promise<unknown> {
    if (this.deadError) throw this.deadError;
    if (this.disposed || !this.child) {
      throw coreError('CORE_INIT_FAILED', 'runner is not running');
    }

    return new Promise<unknown>((resolveCall, rejectCall) => {
      const timer = setTimeout(() => {
        this.removePending(id);
        const err = coreError('CORE_INIT_FAILED', `runner ${label} timed out after ${timeoutMs}ms`);
        // A timed-out runner is presumed wedged; tear it down so callers don't
        // keep piling requests onto a dead pipe.
        this.markDead(err);
        rejectCall(err);
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
      this.pendingOrder.push(id);

      this.child!.stdin.write(frame, (writeErr) => {
        if (writeErr) {
          this.removePending(id);
          clearTimeout(timer);
          rejectCall(
            coreError('CORE_INIT_FAILED', `failed to write to runner: ${writeErr.message}`),
          );
        }
      });
    });
  }

  /** Kill the runner and reject everything still in flight. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.readline?.close();
    this.readline = undefined;
    const child = this.child;
    this.child = undefined;
    this.failAllPending(coreError('CORE_INIT_FAILED', 'runner disposed'));
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolveDispose) => {
      const done = () => resolveDispose();
      child.once('exit', done);
      child.kill('SIGTERM');
      // Hard backstop: if SIGTERM is ignored, SIGKILL and resolve.
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        resolveDispose();
      }, 2000).unref();
    });
  }

  // --- internals ----------------------------------------------------------

  private onLine(line: string): void {
    if (!line.trim()) return;
    let frame: JsonRpcResponse;
    try {
      frame = JSON.parse(line) as JsonRpcResponse;
    } catch {
      // A non-JSON line on stdout means the protocol stream is corrupt; that can
      // only be a broken/incompatible core surface.
      this.markDead(
        coreError(
          'UPSTREAM_INCOMPATIBLE',
          `runner emitted a non-JSON protocol line: ${line.slice(0, 200)}`,
        ),
      );
      return;
    }
    // Normal keyed frames correlate by `id`. A JSON-RPC parse-error frame (-32700)
    // carries id=null because the offending line never parsed, so it cannot key by
    // id — but the runner answers strictly in order, so it belongs to the OLDEST
    // outstanding request (head of pendingOrder). Settling it there is what keeps a
    // malformed sendRaw line from hanging until timeout (DESIGN §14.2 "no hang").
    let id = typeof frame.id === 'number' ? frame.id : undefined;
    if (id === undefined) {
      if (!frame.error) return; // an id-less success frame is meaningless; ignore
      id = this.pendingOrder[0];
      if (id === undefined) return; // nothing outstanding to settle
    }
    const entry = this.pending.get(id);
    if (!entry) return;
    this.removePending(id);
    clearTimeout(entry.timer);

    if (frame.error) {
      entry.reject(fromRpcError(frame.error));
      return;
    }
    entry.resolve(frame.result);
  }

  /** Drop a settled/abandoned request from both the pending map and the FIFO. */
  private removePending(id: number): void {
    this.pending.delete(id);
    const at = this.pendingOrder.indexOf(id);
    if (at !== -1) this.pendingOrder.splice(at, 1);
  }

  private markDead(err: CoreClientError): void {
    if (this.deadError) return;
    this.deadError = err;
    this.failAllPending(err);
  }

  private failAllPending(err: CoreClientError): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
    this.pendingOrder.length = 0;
  }

  private validatorFor(schema: object, key: string): ValidateFunction {
    let v = this.validators.get(key);
    if (!v) {
      v = this.ajv.compile(schema);
      this.validators.set(key, v);
    }
    return v;
  }

  private validateRequest(method: MvpMethod, params: unknown): void {
    const v = this.validatorFor(schemaRegistry[method].requestSchema as object, `${method}:req`);
    if (!v(params)) {
      throw coreError(
        'UPSTREAM_INCOMPATIBLE',
        `request for '${method}' failed schema validation`,
        v.errors,
      );
    }
  }

  private validateResponse(method: MvpMethod, response: unknown): void {
    const v = this.validatorFor(schemaRegistry[method].responseSchema as object, `${method}:res`);
    if (!v(response)) {
      throw coreError(
        'UPSTREAM_INCOMPATIBLE',
        `response for '${method}' failed schema validation`,
        v.errors,
      );
    }
  }
}
