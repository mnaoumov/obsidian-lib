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

import { copyTextManually } from './copy-text-manually.ts';

vi.mock('../plugin/plugin-context.ts', () => ({
  addPluginCssClasses: vi.fn()
}));

let app: AppOriginal;
const buttons: ButtonComponent[] = [];
let contentEl: Element | null = null;

beforeEach(() => {
  app = App.createConfigured__().asOriginalType__();
  buttons.length = 0;
  contentEl = null;
  mockImplementation({
    $object: ButtonComponentOriginal.prototype,
    impl: function impl(this: ButtonComponentOriginal, originalImplementation, containerEl: HTMLElement): ButtonComponentOriginal {
      originalImplementation.call(this, containerEl);
      // The buttons sit in the modal's button container, inside its content element.
      contentEl = containerEl.parentElement;
      buttons.push(castTo<ButtonComponent>(this));
      return this;
    },
    method: 'constructor2__'
  });
});

describe('copyTextManually', () => {
  it('should show the text read-only, select it on focus, and resolve true on OK', async () => {
    const resultPromise = copyTextManually({ app, message: 'Copy this', okButtonText: 'Open', text: 'the report', title: 'Copy' });
    queueMicrotask(() => {
      const textArea = contentEl?.querySelector('textarea');
      if (!textArea) {
        throw new Error('The modal shows no text area');
      }
      expect(textArea.value).toBe('the report');
      expect(textArea.readOnly).toBe(true);
      expect(contentEl?.querySelector('p')?.textContent).toBe('Copy this');
      const select = vi.spyOn(textArea, 'select');
      textArea.dispatchEvent(new FocusEvent('focus'));
      expect(select).toHaveBeenCalled();
      buttons[0]?.simulateClick__();
    });
    expect(await resultPromise).toBe(true);
  });

  it('should resolve false on Cancel', async () => {
    const resultPromise = copyTextManually({ app, message: 'Copy this', text: 'the report' });
    queueMicrotask(() => {
      buttons[1]?.simulateClick__();
    });
    expect(await resultPromise).toBe(false);
  });
});
