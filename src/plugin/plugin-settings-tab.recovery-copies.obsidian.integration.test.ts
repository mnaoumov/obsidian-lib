/**
 * @file
 *
 * Integration tests for the recovery copies button of {@link PluginSettingsTabBase}'s settings management row, driven
 * with trusted clicks in a live Obsidian: the button appears only while copies are kept, the modal lists them, a valid
 * copy is restored after a confirmation, and a damaged copy's text goes to the clipboard instead.
 *
 * The settings component is a stub that records the restore it is asked for: what a restore does to `data.json` is
 * covered by the settings component's own tests, and this file covers the UI that reaches it.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import type { SettingDefinitionItem } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsComponentBase } from '../components/plugin-settings-component.ts';

interface RecoveryCopiesInput {
  readonly choice: RecoveryCopyChoice;
  readonly copies: readonly RecoveryCopyFixture[];
}

interface RecoveryCopiesResult {
  readonly buttonText: null | string;
  readonly clipboardWrites: readonly string[];
  readonly confirmText: null | string;
  readonly copyHeadings: readonly string[];
  readonly restoredIds: readonly string[];
  readonly rowButtonTexts: readonly string[];
}

type RecoveryCopyChoice = 'copy-text' | 'none' | 'restore';

/**
 * A recovery copy as the stub hands it out. Its reason is the wire string, since this file runs in Node and imports no
 * runtime module of the library.
 */
interface RecoveryCopyFixture {
  readonly id: string;
  readonly keptAt: number;
  readonly path: string;
  readonly rawText: string;
  readonly reason: string;
}

const VALID_COPY: RecoveryCopyFixture = {
  id: '2026-11-20T10:00:00.000Z',
  keptAt: Date.UTC(2026, 10, 20, 10),
  path: 'data.json',
  rawText: '{\n  "enabled": true\n}',
  reason: 'lossy-rewrite'
};

const DAMAGED_COPY: RecoveryCopyFixture = {
  id: '2026-11-19T10:00:00.000Z',
  keptAt: Date.UTC(2026, 10, 19, 10),
  path: 'data.json',
  rawText: '{\n  "enabled": tr',
  reason: 'invalid-json'
};

async function runRecoveryCopies(input: RecoveryCopiesInput): Promise<RecoveryCopiesResult> {
  // Under the transport's ~30s per-closure cap, not at it: five 5 s waits (two of them in exclusive branches), three 1 s uncovered checks and two 300 ms settles.
  return await evalInObsidian({
    async callback({ app, choice, copies, lib }): Promise<RecoveryCopiesResult> {
      const {
        castTo,
        clickElement,
        noopAsync,
        PluginSettingsTabBase,
        pressKey,
        useInMemoryClipboard,
        waitUntil
      } = lib;

      interface AsyncEventSourceStub {
        readonly offref: () => void;
      }

      interface EventReferenceStub {
        readonly asyncEventSource: AsyncEventSourceStub;
      }

      interface ProbeSettings {
        readonly enabled: boolean;
      }

      const SETTLE_DELAY_IN_MILLISECONDS = 300;
      const UNCOVERED_TIMEOUT_IN_MILLISECONDS = 1000;

      /*
       * A trusted click lands on whatever is topmost at the element's center. The recovery copies button is the last one
       * of its row, under the top-right corner where notices stack, so a notice another test left showing took the click
       * and nothing opened (2026-11-26, three of four release runs). So wait until the element itself is hit, and
       * name what covers it when it never is.
       */
      async function clickWhenUncovered(element: HTMLElement, name: string): Promise<void> {
        let coveringDescription = '';
        try {
          await waitUntil({
            message: `${name} is not covered`,
            predicate: () => {
              const rect = element.getBoundingClientRect();
              const hitEl = element.doc.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
              if (hitEl !== null && element.contains(hitEl)) {
                return true;
              }
              coveringDescription = hitEl === null ? 'nothing' : `${hitEl.tagName.toLowerCase()}.${hitEl.className}`;
              return false;
            },
            timeoutInMilliseconds: UNCOVERED_TIMEOUT_IN_MILLISECONDS
          });
        } catch (error) {
          throw new Error(`${name} stayed covered by ${coveringDescription}`, { cause: error });
        }
        await clickElement({ element });
      }

      const plugin = Object.values(app.plugins.plugins)[0];
      if (!plugin) {
        throw new Error('no plugin available to host the settings tab');
      }

      const restoredIds: string[] = [];
      const pluginSettingsComponent = castTo<PluginSettingsComponentBase<ProbeSettings>>({
        defaultSettings: { enabled: false },
        getRecoveryCopies: () => Promise.resolve([...copies]),
        on: castTo<PluginSettingsComponentBase<ProbeSettings>['on']>((): EventReferenceStub => ({ asyncEventSource: { offref: () => undefined } })),
        restoreRecoveryCopy: async (id: string): Promise<void> => {
          restoredIds.push(id);
          await noopAsync();
        },
        saveToFile: () => noopAsync(),
        settingsState: {
          effectiveValues: { enabled: false },
          inputValues: { enabled: false },
          validationMessages: { enabled: '' }
        }
      });

      class RecoveryTab extends PluginSettingsTabBase<ProbeSettings> {
        public override getSettingDefinitionItems(): SettingDefinitionItem[] {
          return [this.settingsManagementEx()];
        }
      }

      // An in-memory clipboard, so the test neither depends on the unfocused harness window's clipboard nor overwrites the user's.
      const clipboard = useInMemoryClipboard({ window: activeWindow });
      const tab = new RecoveryTab({ plugin, pluginSettingsComponent });
      app.setting.open();
      app.setting.addSettingTab(tab);
      app.setting.openTab(tab);

      try {
        if (copies.length === 0) {
          await sleep(SETTLE_DELAY_IN_MILLISECONDS);
          return {
            buttonText: tab.containerEl.querySelector('.recovery-copies-button')?.textContent ?? null,
            clipboardWrites: [...clipboard.writtenTexts],
            confirmText: null,
            copyHeadings: [],
            restoredIds,
            rowButtonTexts: []
          };
        }

        await waitUntil({
          message: 'The recovery copies button appears',
          predicate: () => tab.containerEl.querySelector('.recovery-copies-button') !== null
        });
        const recoveryButton = tab.containerEl.querySelector<HTMLElement>('.recovery-copies-button');
        if (!recoveryButton) {
          throw new Error('the recovery copies button vanished');
        }
        const buttonText = recoveryButton.textContent;
        await clickWhenUncovered(recoveryButton, 'The recovery copies button');

        await waitUntil({
          message: 'The recovery copies modal opens',
          predicate: () => activeDocument.querySelector('.settings-recovery-copy') !== null
        });
        const copyEls = [...activeDocument.querySelectorAll<HTMLElement>('.settings-recovery-copy')];
        const copyHeadings = copyEls.map((copyEl) => copyEl.querySelector('h3')?.textContent ?? '');
        const rowButtons = copyEls.map((copyEl) => copyEl.querySelector('button'));
        const rowButtonTexts = rowButtons.map((button) => button?.textContent ?? '');

        let confirmText: null | string = null;
        if (choice !== 'none') {
          const index = rowButtonTexts.indexOf(choice === 'restore' ? 'Restore' : 'Copy text');
          const rowButton = rowButtons[index];
          if (!rowButton) {
            throw new Error(`no ${choice} button in the modal: ${rowButtonTexts.join(', ')}`);
          }
          await clickWhenUncovered(rowButton, `The ${choice} button`);

          if (choice === 'restore') {
            await waitUntil({
              message: 'The restore confirmation opens',
              predicate: () => (activeDocument.querySelector('.confirm-modal')?.querySelector(':scope .ok-button') ?? null) !== null
            });
            confirmText = activeDocument.querySelector('.confirm-modal')?.textContent ?? null;
            const okButton = activeDocument.querySelector('.confirm-modal')?.querySelector<HTMLElement>(':scope .ok-button');
            if (!okButton) {
              throw new Error('the confirmation lost its OK button');
            }
            await clickWhenUncovered(okButton, 'The OK button');
            await waitUntil({
              message: `The copy is restored; restored: ${String(restoredIds.length)}`,
              predicate: () => restoredIds.length > 0
            });
          } else {
            await waitUntil({
              message: `The copy's text reaches the clipboard; writes: ${String(clipboard.writtenTexts.length)}`,
              predicate: () => clipboard.writtenTexts.length > 0
            });
          }
        }
        await sleep(SETTLE_DELAY_IN_MILLISECONDS);

        return {
          buttonText,
          clipboardWrites: [...clipboard.writtenTexts],
          confirmText,
          copyHeadings,
          restoredIds,
          rowButtonTexts
        };
      } finally {
        clipboard.restore();
        for (let attempt = 0; attempt < 2 && activeDocument.querySelector('.settings-recovery-copies-modal, .confirm-modal'); attempt++) {
          await pressKey({ key: 'Escape' });
        }
        app.setting.close();
        app.setting.removeSettingTab(tab);
      }
    },
    input: { choice: input.choice, copies: input.copies }
  });
}

describe('PluginSettingsTabBase recovery copies', () => {
  it('should show no recovery copies button when this device keeps none', async () => {
    const result = await runRecoveryCopies({ choice: 'none', copies: [] });
    expect(result.buttonText).toBeNull();
  });

  it('should list the kept copies, and restore a valid one after a confirmation', async () => {
    const result = await runRecoveryCopies({ choice: 'restore', copies: [VALID_COPY, DAMAGED_COPY] });

    expect(result.buttonText).toBe('Recovery copies (2)');
    expect(result.copyHeadings).toHaveLength(2);
    expect(result.copyHeadings[0]).toContain('kept before the settings were replaced or rewritten');
    expect(result.copyHeadings[1]).toContain('the file was damaged and could not be read');
    expect(result.rowButtonTexts).toEqual(['Restore', 'Copy text']);
    expect(result.confirmText).toContain('The settings in use are kept as a recovery copy first.');
    expect(result.restoredIds).toEqual([VALID_COPY.id]);
    expect(result.clipboardWrites).toEqual([]);
  });

  it('should copy the text of a damaged copy to the clipboard instead of restoring it', async () => {
    const result = await runRecoveryCopies({ choice: 'copy-text', copies: [DAMAGED_COPY] });

    expect(result.rowButtonTexts).toEqual(['Copy text']);
    expect(result.clipboardWrites).toEqual([DAMAGED_COPY.rawText]);
    expect(result.restoredIds).toEqual([]);
  });
});
