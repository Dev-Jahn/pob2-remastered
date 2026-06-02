/**
 * @pob2/desktop App production-wiring integration test (code-review follow-up).
 *
 * The review found the shipped App discarded the Save/Export result and left
 * several panel callbacks unwired. This renders the real `App` composition (the
 * level the shipped app uses) with an injected session + the host hooks and asserts
 * the production wiring exists: running the Save command actually DELIVERS the
 * export (it is no longer discarded), and the Config tab's per-option edit reaches
 * `config.setOption`. Guards against the dead-ends regressing.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { BuildSaveResponse, CalcRunResponse } from '@pob2/schema';
import { App } from './App.js';
import type { BuildSession } from './build-session.js';

afterEach(cleanup);

const STATS: CalcRunResponse = {
  buildId: 'b1',
  stats: [{ statId: 'Life', value: 65, label: 'Life' }],
};

/** A recording session: open() populates the build; save()/setConfigOption record. */
function recordingSession() {
  const saved: BuildSaveResponse[] = [];
  const configWrites: Array<{ optionId: string; value: unknown }> = [];
  const session: BuildSession = {
    async open() {
      return { summary: { className: 'Ranger', level: 1 }, stats: STATS };
    },
    async save({ format }) {
      const result: BuildSaveResponse =
        format === 'shareCode'
          ? { format: 'shareCode', data: 'eNpCODE' }
          : { format: 'xml', data: '<xml/>' };
      saved.push(result);
      return result;
    },
    async getEquipped() {
      return { equipped: [] };
    },
    async parseClipboard() {
      throw new Error('unused');
    },
    async getSkillGroups() {
      return { groups: [] };
    },
    async setGemGroup() {
      throw new Error('unused');
    },
    async getConfigOptions() {
      return {
        options: [
          {
            optionId: 'enemyShocked',
            type: 'check',
            label: 'Shocked',
            value: false,
            dependentModifiers: [],
          },
        ],
      };
    },
    async setConfigOption(optionId, value) {
      configWrites.push({ optionId, value });
      return STATS;
    },
    async explainStat() {
      throw new Error('unused');
    },
    async getTreeData() {
      return {
        graph: {
          nodes: [],
          edges: [],
          bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
          nodeIndex: {},
        },
        allocated: new Set<number>(),
      };
    },
    async previewAllocate() {
      throw new Error('unused');
    },
    async applyAllocate() {
      throw new Error('unused');
    },
  };
  return { session, saved, configWrites };
}

function runCommand(commandId: string): void {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  const target = document.querySelector(`[data-command-id="${commandId}"]`) as HTMLElement | null;
  if (!target) throw new Error(`command not found: ${commandId}`);
  fireEvent.click(target);
}

describe('App production wiring (review follow-up)', () => {
  it('the Save command DELIVERS the export (P0 — no longer discarded)', async () => {
    const { session, saved } = recordingSession();
    const deliver = vi.fn<(r: BuildSaveResponse) => void>();
    render(
      <App
        session={session}
        resolveOpenSource={async () => ({ xml: '<x/>' })}
        deliverSaveResult={deliver}
      />,
    );

    runCommand('build-open');
    await screen.findByText('65');

    runCommand('build-save');
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
    expect(deliver).toHaveBeenCalledWith({ format: 'xml', data: '<xml/>' });
    expect(saved).toHaveLength(1);

    runCommand('build-save-share-code');
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(2));
    expect(deliver).toHaveBeenLastCalledWith({ format: 'shareCode', data: 'eNpCODE' });
  });

  it('editing a Config option reaches config.setOption (P1 — onChangeOption wired)', async () => {
    const { session, configWrites } = recordingSession();
    render(
      <App
        session={session}
        resolveOpenSource={async () => ({ xml: '<x/>' })}
        deliverSaveResult={vi.fn()}
      />,
    );

    runCommand('build-open');
    await screen.findByText('65');

    // Jump to the Config tab and toggle the (single) option's checkbox.
    runCommand('config-apply-preset');
    await screen.findByText('Shocked'); // the §10.8 option row rendered
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    await vi.waitFor(() => expect(configWrites).toHaveLength(1));
    expect(configWrites[0]).toEqual({ optionId: 'enemyShocked', value: true });
  });
});
