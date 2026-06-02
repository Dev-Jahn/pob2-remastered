/**
 * App skills gem-toggle integration test (review P1 follow-up).
 *
 * The review showed `onToggleGem` could not be wired without reordering gems
 * (skills.getGroups splits them into active/support, losing socket order). The fix
 * carries the ORIGINAL ordered `gems` on the SkillGroupCard. This asserts that
 * toggling a gem re-sends the group's gems in their original order with exactly one
 * `enabled` flipped — never a reordered list (which would be a real calc bug).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { CalcRunResponse, GemInput, SkillsGetGroupsResponse } from '@pob2/schema';
import { App } from './App.js';
import type { BuildSession } from './build-session.js';

afterEach(cleanup);

const STATS: CalcRunResponse = {
  buildId: 'b1',
  stats: [{ statId: 'Life', value: 65, label: 'Life' }],
};
const gem = (gemId: string, enabled: boolean) => ({
  gemId,
  name: gemId,
  level: 20,
  quality: 0,
  enabled,
});

// A group whose gems are ordered [active Spark, support AddedLightning], both enabled.
const GROUPS: SkillsGetGroupsResponse = {
  groups: [
    {
      groupId: 'g1',
      label: 'Spark',
      enabled: true,
      spirit: 0,
      reservation: 0,
      gems: [gem('Spark', true), gem('AddedLightning', true)],
      activeGems: [gem('Spark', true)],
      supportGems: [gem('AddedLightning', true)],
    },
  ],
};

function makeSession() {
  const gemWrites: Array<{ groupId: string; gems: GemInput[] }> = [];
  const session: BuildSession = {
    async open() {
      return { summary: { className: 'Sorceress', level: 1 }, stats: STATS };
    },
    async save() {
      return { format: 'xml', data: '<x/>' };
    },
    async getEquipped() {
      return { equipped: [] };
    },
    async parseClipboard() {
      throw new Error('unused');
    },
    async getSkillGroups() {
      return GROUPS;
    },
    async setGemGroup(groupId, gems) {
      gemWrites.push({ groupId, gems });
      return STATS;
    },
    async getConfigOptions() {
      return { options: [] };
    },
    async setConfigOption() {
      throw new Error('unused');
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
  return { session, gemWrites };
}

function runCommand(commandId: string): void {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  const target = document.querySelector(`[data-command-id="${commandId}"]`) as HTMLElement | null;
  if (!target) throw new Error(`command not found: ${commandId}`);
  fireEvent.click(target);
}

describe('App skills gem toggle (order-preserving, review P1)', () => {
  it('re-sends the group gems in ORIGINAL order with exactly one enabled flipped', async () => {
    const { session, gemWrites } = makeSession();
    render(
      <App
        session={session}
        resolveOpenSource={async () => ({ xml: '<x/>' })}
        deliverSaveResult={vi.fn()}
      />,
    );
    runCommand('build-open');
    await screen.findByText('65');

    // Go to the Skills tab and toggle a gem (checkbox[0] is the group-enable, [1+] are gems).
    runCommand('nav-skills');
    const checkboxes = await screen.findAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);

    await vi.waitFor(() => expect(gemWrites).toHaveLength(1));
    const write = gemWrites[0]!;
    expect(write.groupId).toBe('g1');
    // ORDER preserved (the key property): the gems go out as [Spark, AddedLightning], not reordered.
    expect(write.gems.map((g) => g.gemId)).toEqual(['Spark', 'AddedLightning']);
    // Exactly one gem's enabled was flipped off.
    expect(write.gems.filter((g) => !g.enabled)).toHaveLength(1);
  });
});
