// @vitest-environment jsdom

import type { App as AppOriginal } from 'obsidian';
import type { ButtonComponent } from 'obsidian-test-mocks/obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { mockImplementation } from '@mnaoumov/typescript-test-toolkit/mock-implementation';
import { ButtonComponent as ButtonComponentOriginal } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { SettingsRecoveryCopy } from '../settings-recovery.ts';

import { SettingsRecoveryReason } from '../settings-recovery.ts';
import {
  formatKeptAt,
  selectSettingsRecoveryCopy,
  SETTINGS_RECOVERY_COPY_PREVIEW_LENGTH,
  SettingsRecoveryCopyAction
} from './settings-recovery-copies.ts';

vi.mock('../plugin/plugin-context.ts', () => ({
  addPluginCssClasses: vi.fn()
}));

const VALID_COPY: SettingsRecoveryCopy = {
  id: 'valid',
  keptAt: Date.UTC(2026, 10, 20, 10),
  path: 'data.json',
  rawText: '{"name":"kept"}',
  reason: SettingsRecoveryReason.LossyRewrite
};

const DAMAGED_COPY: SettingsRecoveryCopy = {
  id: 'damaged',
  keptAt: Date.UTC(2026, 10, 19, 10),
  path: 'data.json',
  rawText: `{"name":"${'x'.repeat(SETTINGS_RECOVERY_COPY_PREVIEW_LENGTH)}`,
  reason: SettingsRecoveryReason.InvalidJson
};

let app: AppOriginal;
const buttons: ButtonComponent[] = [];
let modalContentEl: Element | null = null;

beforeEach(() => {
  app = App.createConfigured__().asOriginalType__();
  buttons.length = 0;
  modalContentEl = null;
  mockImplementation({
    $object: ButtonComponentOriginal.prototype,
    impl: function impl(this: ButtonComponentOriginal, originalImplementation, containerEl: HTMLElement): ButtonComponentOriginal {
      originalImplementation.call(this, containerEl);
      // Each copy's button sits in the copy's element, inside the modal's content element.
      modalContentEl = containerEl.parentElement;
      buttons.push(castTo<ButtonComponent>(this));
      return this;
    },
    method: 'constructor2__'
  });
});

describe('selectSettingsRecoveryCopy', () => {
  it('should list each copy with its date, reason and a preview, and resolve Restore for a valid one', async () => {
    const resultPromise = selectSettingsRecoveryCopy({ app, copies: [VALID_COPY, DAMAGED_COPY] });
    queueMicrotask(() => {
      const copyEls = [...modalContentEl?.querySelectorAll<HTMLElement>('.settings-recovery-copy') ?? []];
      expect(copyEls.map((copyEl) => copyEl.dataset['copyId'])).toEqual(['valid', 'damaged']);
      expect(copyEls[0]?.querySelector('h3')?.textContent).toBe(
        `${formatKeptAt(VALID_COPY.keptAt)}: kept before the settings were replaced or rewritten`
      );
      expect(copyEls[1]?.querySelector('h3')?.textContent).toBe(`${formatKeptAt(DAMAGED_COPY.keptAt)}: the file was damaged and could not be read`);
      expect(copyEls[0]?.querySelector('pre')?.textContent).toBe(VALID_COPY.rawText);
      expect(copyEls[1]?.querySelector('pre')?.textContent).toBe(`${DAMAGED_COPY.rawText.slice(0, SETTINGS_RECOVERY_COPY_PREVIEW_LENGTH)}…`);
      expect(buttons.map((button) => button.buttonEl.textContent)).toEqual(['Restore', 'Copy text', 'Cancel']);
      buttons[0]?.simulateClick__();
    });
    expect(await resultPromise).toEqual({ action: SettingsRecoveryCopyAction.Restore, copy: VALID_COPY });
  });

  it('should resolve CopyText for a copy that is not valid JSON', async () => {
    const resultPromise = selectSettingsRecoveryCopy({ app, copies: [DAMAGED_COPY] });
    queueMicrotask(() => {
      buttons[0]?.simulateClick__();
    });
    expect(await resultPromise).toEqual({ action: SettingsRecoveryCopyAction.CopyText, copy: DAMAGED_COPY });
  });

  it('should resolve null on Cancel', async () => {
    const resultPromise = selectSettingsRecoveryCopy({ app, copies: [VALID_COPY] });
    queueMicrotask(() => {
      buttons[1]?.simulateClick__();
    });
    expect(await resultPromise).toBeNull();
  });
});
