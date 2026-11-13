/**
 * @file
 *
 * The pointer half of the subpath-format recipe, desktop only because a phone has no pointer to hover with and no
 * modifier keys: a trusted hover over a Reading-view link shows the format's own embed in the page preview, and a
 * Mod-click opens the format's view in a new tab with the link's subpath. The cross-platform cases are in
 * `embed-extensions-component.obsidian.integration.test.ts`.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

interface DesktopSubpathFormatFixture {
  readonly dispose: () => void;
}

interface PointerResult {
  readonly hoverText: string;
  readonly isNoteLeafKept: boolean;
  readonly viewText: string;
}

declare global {
  interface Window {
    readonly __desktopSubpathFormatFixture?: DesktopSubpathFormatFixture;
  }
}

const VIEW_TYPE = 'subpath-format-desktop-csv';
const FOLDER = 'subpath-format-desktop';
const NOTE_PATH = `${FOLDER}/Links.md`;
const LINK = 'rows.csv#row=2';

beforeAll(async () => {
  await evalInObsidian({
    async callback({ app, constants, lib: { EmbedExtensionsComponent, invokeAsyncSafely }, obsidianModule: { Component, FileView } }): Promise<void> {
      const plugin = app.plugins.getPlugin('obsidian-lib-integration-test');
      if (!plugin) {
        throw new Error('The harness plugin is not loaded.');
      }
      if (app.viewRegistry.isExtensionRegistered('csv') || app.embedRegistry.isExtensionRegistered('csv')) {
        throw new Error('The extension "csv" is already registered, so the fixture cannot own it.');
      }

      // The format's one resolver, shared by its embed and its view.
      async function describeRow(file: TFile, subpath: string): Promise<string> {
        const row = /^#row=(?<row>\d+)$/.exec(subpath)?.groups?.['row'];
        const content = await app.vault.cachedRead(file);
        const line = row === undefined ? undefined : content.split('\n').slice(1)[Number(row) - 1];
        return line ? `row ${row ?? ''}: ${line}` : `unresolved: ${subpath}`;
      }

      class RowEmbedComponent extends Component {
        public constructor(private readonly file: TFile, private readonly subpath: string, private readonly containerEl: HTMLElement) {
          super();
        }

        public async loadFile(): Promise<void> {
          this.containerEl.createDiv({ cls: 'subpath-format-desktop-embed', text: await describeRow(this.file, this.subpath) });
        }
      }

      class RowView extends FileView {
        private subpath = '';

        public override getViewType(): string {
          return constants.VIEW_TYPE;
        }

        public override async onLoadFile(file: TFile): Promise<void> {
          await super.onLoadFile(file);
          await this.render();
        }

        public override setEphemeralState(state: unknown): void {
          super.setEphemeralState(state);
          if (!(typeof state === 'object' && state !== null && 'subpath' in state && typeof state.subpath === 'string')) {
            return;
          }

          this.subpath = state.subpath;
          invokeAsyncSafely(() => this.render());
        }

        private async render(): Promise<void> {
          if (!this.file) {
            return;
          }
          const text = await describeRow(this.file, this.subpath);
          this.contentEl.empty();
          this.contentEl.createDiv({ cls: 'subpath-format-desktop-view', text });
        }
      }

      plugin.registerView(constants.VIEW_TYPE, (leaf) => new RowView(leaf));
      app.viewRegistry.registerExtensions(['csv'], constants.VIEW_TYPE);
      const embeds = new EmbedExtensionsComponent(app);
      embeds.load();
      embeds.registerExtensions(['csv'], (context, file, subpath = '') => new RowEmbedComponent(file, subpath, context.containerEl));

      await app.vault.createFolder(constants.FOLDER);
      await app.vault.create(`${constants.FOLDER}/rows.csv`, 'name,count\napple,1\nbanana,2\n');
      await app.vault.create(constants.NOTE_PATH, `Link: [[${constants.LINK}]]\n`);

      Reflect.set(
        window,
        '__desktopSubpathFormatFixture',
        {
          dispose(): void {
            embeds.unload();
            app.viewRegistry.unregisterExtensions(['csv']);
            app.viewRegistry.unregisterView(constants.VIEW_TYPE);
          }
        } satisfies DesktopSubpathFormatFixture
      );
    },
    input: { constants: { FOLDER, LINK, NOTE_PATH, VIEW_TYPE } }
  });
});

afterAll(async () => {
  await evalInObsidian({
    async callback({ app, constants }): Promise<void> {
      // eslint-disable-next-line unicorn/no-optional-chaining-on-undeclared-variable -- The closure runs in Obsidian, where `window` is always declared; only the fixture may be missing.
      window.__desktopSubpathFormatFixture?.dispose();
      Reflect.deleteProperty(window, '__desktopSubpathFormatFixture');
      const folder = app.vault.getFolderByPath(constants.FOLDER);
      if (folder) {
        await app.fileManager.trashFile(folder);
      }
    },
    input: { constants: { FOLDER } }
  });
});

describe('EmbedExtensionsComponent with a subpath-aware format, by pointer', () => {
  it('should show the format embed for the hovered subpath and open the view in a new tab on Mod-click', async () => {
    const result = await evalInObsidian({
      // Under the transport's ~30s per-closure cap, not at it. Three 5 s waits: the render, the popover, the new tab.
      async callback({ app, constants, lib: { clickElement, hoverElement, unhoverElement, waitUntil } }): Promise<PointerResult> {
        const note = app.vault.getFileByPath(constants.NOTE_PATH);
        if (!note) {
          throw new Error('The fixture is not set up.');
        }
        const leaf = app.workspace.getLeaf('tab');
        const selector = `:scope .markdown-reading-view a.internal-link[data-href="${constants.LINK}"]`;
        try {
          await leaf.openFile(note, { active: true, state: { mode: 'preview' } });
          await waitUntil({
            message: 'The link did not render.',
            predicate: () => leaf.view.containerEl.querySelector(selector) !== null,
            timeoutInMilliseconds: 5000
          });
          const linkEl = leaf.view.containerEl.querySelector<HTMLElement>(selector);
          if (!linkEl) {
            throw new Error('The link is missing.');
          }

          await hoverElement({ element: linkEl });
          let hoverText = '';
          await waitUntil({
            message: 'The hover popover did not show the format embed.',
            predicate: () => {
              hoverText = activeDocument.querySelector(':scope .hover-popover .subpath-format-desktop-embed')?.textContent ?? '';
              return hoverText !== '';
            },
            timeoutInMilliseconds: 5000
          });
          await unhoverElement({ element: linkEl });

          await clickElement({ element: linkEl, modifiers: ['Mod'] });
          function readViewText(): string {
            const [openedLeaf] = app.workspace.getLeavesOfType(constants.VIEW_TYPE);
            return openedLeaf?.view.containerEl.querySelector(':scope .subpath-format-desktop-view')?.textContent ?? '';
          }
          await waitUntil({
            message: 'Mod-click did not open the view in a new tab.',
            predicate: () => readViewText() !== '',
            timeoutInMilliseconds: 5000
          });
          return { hoverText, isNoteLeafKept: leaf.view.getViewType() === 'markdown', viewText: readViewText() };
        } finally {
          app.workspace.detachLeavesOfType(constants.VIEW_TYPE);
          leaf.detach();
          for (const popover of activeDocument.querySelectorAll('.hover-popover')) {
            popover.remove();
          }
        }
      },
      input: { constants: { LINK, NOTE_PATH, VIEW_TYPE } }
    });

    expect(result).toEqual({ hoverText: 'row 2: banana,2', isNoteLeafKept: true, viewText: 'row 2: banana,2' });
  });
});
