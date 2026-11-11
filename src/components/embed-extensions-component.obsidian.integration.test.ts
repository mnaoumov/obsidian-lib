/**
 * @file
 *
 * Proves the recipe for a non-Markdown format that understands its own link subpaths, in a real Obsidian: a CSV
 * provider (`#row=2`, `#rows=2-3`) and a code-symbol provider (`#greet`) each own one pure resolver, an
 * {@link EmbedExtensionsComponent} registration and a file view, and the same resolver answers every surface.
 *
 * What it pins, read from Obsidian `1.15.1`: Reading view, Live Preview and the page-preview hover all load an embed
 * through `embedRegistry.getEmbedCreator`, passing the subpath with its leading `#` and without percent-decoding it;
 * following a link passes the same subpath to the opened view as `eState.subpath`; a link to a missing file never
 * reaches the creator; and unloading the component hands the extension back to Obsidian's generic file embed.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import type {
  TFile,
  WorkspaceLeaf
} from 'obsidian';

import dedent from 'dedent';
import { evalInObsidian } from 'obsidian-integration-testing';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

interface AmbiguousResolution {
  readonly kind: 'ambiguous';
  readonly lines: readonly number[];
  readonly name: string;
}

interface ClickResult {
  readonly text: string;
  readonly viewType: string;
}

interface ConflictResult {
  readonly isCsvStillOwned: boolean;
  readonly isTsvRegistered: boolean;
  readonly message: string;
}

interface EmbedObservation {
  readonly subpath: string;
  readonly text: string;
}

interface EmbedsResult {
  readonly creatorCalls: string[];
  readonly embeds: EmbedObservation[];
  readonly missingFileEmbedClass: string;
}

interface InvalidResolution {
  readonly kind: 'invalid';
  readonly subpath: string;
}

interface MissingResolution {
  readonly kind: 'missing';
  readonly what: string;
}

interface RowsResolution {
  readonly from: number;
  readonly kind: 'rows';
  readonly rows: readonly string[];
  readonly to: number;
}

interface SubpathFormatFixture {
  /**
   * Every `<file path><subpath>` Obsidian handed an embed creator, in order.
   */
  readonly creatorCalls: string[];

  /**
   * Unregisters the views and unloads the embed registrations.
   */
  readonly dispose: () => void;

  /**
   * Loads the embed registrations again after {@link unloadEmbeds}; does nothing while they are loaded.
   */
  readonly loadEmbeds: () => void;

  /**
   * Unloads only the embed registrations, as a plugin unload would.
   */
  readonly unloadEmbeds: () => void;
}

interface SymbolResolution {
  readonly kind: 'symbol';
  readonly line: string;
  readonly name: string;
}

interface UnloadResult {
  readonly afterReload: number;
  readonly isRegisteredAfterUnload: boolean;
  readonly unloadedLoaded: number;
  readonly unloadedOwn: number;
}

interface WholeResolution {
  readonly kind: 'whole';
}

declare global {
  interface Window {
    readonly __subpathFormatFixture?: SubpathFormatFixture;
  }
}

const CSV_VIEW_TYPE = 'subpath-format-csv';
const CODE_VIEW_TYPE = 'subpath-format-code';
const FOLDER = 'subpath-format';
const NOTE_PATH = `${FOLDER}/notes/Embeds.md`;
const LINK = '../data.csv#row=2';

const NOTE_CONTENT = dedent`
  ![[../data.csv#row=2]]

  ![[../data.csv#rows=2-3]]

  ![[./local.csv#row=1]]

  ![[../data.csv#row=99]]

  ![[../data.csv#color=red]]

  ![[../lib.py#greet]]

  ![[../lib.py#helper]]

  ![[../lib.py#missing]]

  ![[../absent.csv#row=1]]

  ![](../data.csv#row=1)

  ![](../data.csv#row%3D3)

  Link: [[${LINK}]]
`;

const EXPECTED_EMBEDS: readonly EmbedObservation[] = [
  { subpath: '#row=2', text: 'row 2: banana,2' },
  { subpath: '#rows=2-3', text: 'rows 2-3: banana,2 | cherry,3' },
  { subpath: '#row=1', text: 'row 1: local,9' },
  { subpath: '#row=99', text: 'missing: row 99 of 3' },
  { subpath: '#color=red', text: 'invalid: #color=red' },
  { subpath: '#greet', text: 'symbol greet: def greet(name):' },
  { subpath: '#helper', text: 'ambiguous: helper at lines 4, 7' },
  { subpath: '#missing', text: 'missing: symbol missing' },
  { subpath: '#row=1', text: 'row 1: apple,1' },
  // Obsidian hands a Markdown link's subpath over still percent-encoded; this resolver does not decode it.
  { subpath: '#row%3D3', text: 'invalid: #row%3D3' }
];

beforeAll(async () => {
  await evalInObsidian({
    async callback({ app, constants, lib: { EmbedExtensionsComponent, invokeAsyncSafely }, obsidianModule: { Component, FileView } }): Promise<void> {
      type Resolution = AmbiguousResolution | InvalidResolution | MissingResolution | RowsResolution | SymbolResolution | WholeResolution;
      const plugin = app.plugins.getPlugin('obsidian-lib-integration-test');
      if (!plugin) {
        throw new Error('The harness plugin is not loaded.');
      }
      for (const extension of ['csv', 'py']) {
        if (app.viewRegistry.isExtensionRegistered(extension) || app.embedRegistry.isExtensionRegistered(extension)) {
          throw new Error(`The extension "${extension}" is already registered, so the fixture cannot own it.`);
        }
      }

      // The ONE resolver per format, shared by the embed and the view. Line and row numbers are positions, not
      // Identities: an edit above the target moves what they point at, and nothing here tracks renames.
      function resolveCsv(content: string, subpath: string): Resolution {
        if (!subpath) {
          return { kind: 'whole' };
        }
        const match = /^#rows?=(?<from>\d+)(?:-(?<to>\d+))?$/.exec(subpath);
        if (!match?.groups) {
          return { kind: 'invalid', subpath };
        }
        const from = Number(match.groups['from']);
        const to = match.groups['to'] === undefined ? from : Number(match.groups['to']);
        const dataRows = content.split('\n').slice(1).filter((line) => line !== '');
        return from < 1 || to < from || to > dataRows.length ? { kind: 'missing', what: `row ${String(to)} of ${String(dataRows.length)}` } : { from, kind: 'rows', rows: dataRows.slice(from - 1, to), to };
      }

      function resolveCode(content: string, subpath: string): Resolution {
        if (!subpath) {
          return { kind: 'whole' };
        }
        const name = subpath.slice(1);
        if (!/^[A-Za-z_]\w*$/.test(name)) {
          return { kind: 'invalid', subpath };
        }
        const pattern = new RegExp(String.raw`^\s*(?:def|class) ${name}\b`);
        const lines = content.split('\n');
        const matches: number[] = [];
        for (const [index, line] of lines.entries()) {
          if (pattern.test(line)) {
            matches.push(index + 1);
          }
        }
        const [lineNumber] = matches;
        if (lineNumber === undefined) {
          return { kind: 'missing', what: `symbol ${name}` };
        }
        if (matches.length > 1) {
          return { kind: 'ambiguous', lines: matches, name };
        }
        return { kind: 'symbol', line: lines[lineNumber - 1] ?? '', name };
      }

      function describeResolution(resolution: Resolution): string {
        switch (resolution.kind) {
          case 'ambiguous': {
            return `ambiguous: ${resolution.name} at lines ${resolution.lines.map(String).join(', ')}`;
          }
          case 'invalid': {
            return `invalid: ${resolution.subpath}`;
          }
          case 'missing': {
            return `missing: ${resolution.what}`;
          }
          case 'rows': {
            return resolution.from === resolution.to
              ? `row ${String(resolution.from)}: ${resolution.rows.join(' | ')}`
              : `rows ${String(resolution.from)}-${String(resolution.to)}: ${resolution.rows.join(' | ')}`;
          }
          case 'symbol': {
            return `symbol ${resolution.name}: ${resolution.line.trim()}`;
          }
          case 'whole': {
            return 'whole file';
          }
          default: {
            throw new Error('Unknown resolution.');
          }
        }
      }

      async function describeTarget(file: TFile, subpath: string): Promise<string> {
        const resolver = file.extension === 'py' ? resolveCode : resolveCsv;
        return describeResolution(resolver(await app.vault.cachedRead(file), subpath));
      }

      const creatorCalls: string[] = [];

      class SubpathEmbedComponent extends Component {
        private readonly el: HTMLElement;

        public constructor(private readonly file: TFile, private readonly subpath: string, containerEl: HTMLElement) {
          super();
          this.el = containerEl.createDiv({ cls: 'subpath-format-embed' });
          this.el.dataset['subpath'] = subpath;
        }

        public async loadFile(): Promise<void> {
          await this.render();
        }

        public override onload(): void {
          this.registerEvent(app.vault.on('modify', (file) => {
            if (file === this.file) {
              invokeAsyncSafely(() => this.render());
            }
          }));
        }

        private async render(): Promise<void> {
          this.el.setText(await describeTarget(this.file, this.subpath));
        }
      }

      class SubpathFileView extends FileView {
        private subpath = '';

        public constructor(leaf: WorkspaceLeaf, private readonly viewType: string) {
          super(leaf);
        }

        public override getViewType(): string {
          return this.viewType;
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
          const text = await describeTarget(this.file, this.subpath);
          this.contentEl.empty();
          this.contentEl.createDiv({ cls: 'subpath-format-view', text });
        }
      }

      plugin.registerView(constants.CSV_VIEW_TYPE, (leaf) => new SubpathFileView(leaf, constants.CSV_VIEW_TYPE));
      plugin.registerView(constants.CODE_VIEW_TYPE, (leaf) => new SubpathFileView(leaf, constants.CODE_VIEW_TYPE));
      app.viewRegistry.registerExtensions(['csv'], constants.CSV_VIEW_TYPE);
      app.viewRegistry.registerExtensions(['py'], constants.CODE_VIEW_TYPE);

      let embeds: InstanceType<typeof EmbedExtensionsComponent> | null = null;
      function loadEmbeds(): void {
        if (embeds) {
          return;
        }
        embeds = new EmbedExtensionsComponent(app);
        embeds.load();
        embeds.registerExtensions(['csv', 'py'], (context, file, subpath = '') => {
          creatorCalls.push(`${file.path}${subpath}`);
          return new SubpathEmbedComponent(file, subpath, context.containerEl);
        });
      }
      function unloadEmbeds(): void {
        embeds?.unload();
        embeds = null;
      }
      loadEmbeds();

      await app.vault.createFolder(`${constants.FOLDER}/notes`);
      await app.vault.create(`${constants.FOLDER}/data.csv`, 'name,count\napple,1\nbanana,2\ncherry,3\n');
      await app.vault.create(`${constants.FOLDER}/notes/local.csv`, 'name,count\nlocal,9\n');
      await app.vault.create(`${constants.FOLDER}/lib.py`, 'def greet(name):\n    return name\n\ndef helper():\n    pass\n\ndef helper():\n    pass\n');
      await app.vault.create(constants.NOTE_PATH, constants.NOTE_CONTENT);

      Reflect.set(
        window,
        '__subpathFormatFixture',
        {
          creatorCalls,
          dispose(): void {
            unloadEmbeds();
            app.viewRegistry.unregisterExtensions(['csv', 'py']);
            app.viewRegistry.unregisterView(constants.CSV_VIEW_TYPE);
            app.viewRegistry.unregisterView(constants.CODE_VIEW_TYPE);
          },
          loadEmbeds,
          unloadEmbeds
        } satisfies SubpathFormatFixture
      );
    },
    input: { constants: { CODE_VIEW_TYPE, CSV_VIEW_TYPE, FOLDER, NOTE_CONTENT, NOTE_PATH } }
  });
});

afterAll(async () => {
  await evalInObsidian({
    async callback({ app, constants }): Promise<void> {
      window.__subpathFormatFixture?.dispose();
      Reflect.deleteProperty(window, '__subpathFormatFixture');
      const folder = app.vault.getFolderByPath(constants.FOLDER);
      if (folder) {
        await app.fileManager.trashFile(folder);
      }
    },
    input: { constants: { FOLDER } }
  });
});

describe('EmbedExtensionsComponent with a subpath-aware format', () => {
  it.each([
    { mode: 'preview', name: 'Reading view' },
    { mode: 'source', name: 'Live Preview' }
  ])('should resolve every embed subpath in $name', async ({ mode }) => {
    const result = await evalInObsidian({
      // Under the transport's ~30s per-closure cap, not at it. One 10 s wait for the embeds to render.
      async callback({ app, constants, lib: { waitUntil } }): Promise<EmbedsResult> {
        const fixture = window.__subpathFormatFixture;
        const file = app.vault.getFileByPath(constants.NOTE_PATH);
        if (!fixture || !file) {
          throw new Error('The fixture is not set up.');
        }
        fixture.creatorCalls.length = 0;
        const leaf = app.workspace.getLeaf('tab');
        try {
          await leaf.openFile(file, { active: true, state: { mode: constants.mode, source: false } });
          const root = leaf.view.containerEl.querySelector(constants.mode === 'preview' ? ':scope .markdown-reading-view' : ':scope .markdown-source-view');
          if (!root) {
            throw new Error('The view root is missing.');
          }
          function readEmbeds(): EmbedObservation[] {
            return Array.from(root?.querySelectorAll<HTMLElement>(':scope .subpath-format-embed') ?? [], (el) => ({
              subpath: el.dataset['subpath'] ?? '',
              text: el.textContent
            }));
          }
          await waitUntil({
            message: 'The embeds did not render.',
            predicate: () => readEmbeds().length === constants.count && readEmbeds().every((embed) => embed.text !== ''),
            timeoutInMilliseconds: 10_000
          });
          return {
            creatorCalls: [...fixture.creatorCalls],
            embeds: readEmbeds(),
            missingFileEmbedClass: root.querySelector(':scope .internal-embed[src="../absent.csv#row=1"]')?.className ?? ''
          };
        } finally {
          leaf.detach();
        }
      },
      input: { constants: { count: EXPECTED_EMBEDS.length, mode, NOTE_PATH } }
    });

    expect(result.embeds).toEqual(EXPECTED_EMBEDS);
    expect(result.creatorCalls.some((call) => call.includes('absent.csv'))).toBe(false);
    // A missing file never reaches the creator: Obsidian renders its own empty-file embed instead.
    expect(result.missingFileEmbedClass).toMatch(/\bfile-embed\b.*\bmod-empty/);
  });

  it('should pass the hovered link subpath to the embed creator in the page preview', async () => {
    const result = await evalInObsidian({
      // Under the transport's ~30s per-closure cap, not at it. Two 10 s waits: the render, then the popover.
      async callback({ app, constants, lib: { waitUntil } }): Promise<string> {
        const file = app.vault.getFileByPath(constants.NOTE_PATH);
        if (!file) {
          throw new Error('The fixture is not set up.');
        }
        const leaf = app.workspace.getLeaf('tab');
        const selector = `:scope .markdown-reading-view a.internal-link[data-href="${constants.LINK}"]`;
        try {
          await leaf.openFile(file, { active: true, state: { mode: 'preview' } });
          await waitUntil({
            message: 'The link did not render.',
            predicate: () => leaf.view.containerEl.querySelector(selector) !== null,
            timeoutInMilliseconds: 10_000
          });
          // A phone has no pointer to hover with, so this raises the `hover-link` event Obsidian's own Reading-view link
          // Handler raises; the `.desktop` file drives the same popover with a trusted pointer.
          app.workspace.trigger('hover-link', {
            event: new MouseEvent('mouseover'),
            hoverParent: leaf.view,
            linktext: constants.LINK,
            source: 'preview',
            sourcePath: constants.NOTE_PATH,
            targetEl: leaf.view.containerEl.querySelector(selector)
          });
          let text = '';
          await waitUntil({
            message: 'The hover popover did not show the embed.',
            predicate: () => {
              text = activeDocument.querySelector(':scope .hover-popover .subpath-format-embed')?.textContent ?? '';
              return text !== '';
            },
            timeoutInMilliseconds: 10_000
          });
          return text;
        } finally {
          leaf.detach();
          for (const popover of activeDocument.querySelectorAll('.hover-popover')) {
            popover.remove();
          }
        }
      },
      input: { constants: { LINK, NOTE_PATH } }
    });

    expect(result).toBe('row 2: banana,2');
  });

  it('should hand the clicked link subpath to the opened view through the same resolver', async () => {
    const result = await evalInObsidian({
      // Under the transport's ~30s per-closure cap, not at it. Two 10 s waits: the render, then the opened view.
      async callback({ app, constants, lib: { clickElement, waitUntil } }): Promise<ClickResult> {
        const file = app.vault.getFileByPath(constants.NOTE_PATH);
        if (!file) {
          throw new Error('The fixture is not set up.');
        }
        const leaf = app.workspace.getLeaf('tab');
        const selector = `:scope .markdown-reading-view a.internal-link[data-href="${constants.LINK}"]`;
        try {
          await leaf.openFile(file, { active: true, state: { mode: 'preview' } });
          await waitUntil({
            message: 'The link did not render.',
            predicate: () => leaf.view.containerEl.querySelector(selector) !== null,
            timeoutInMilliseconds: 10_000
          });
          const linkEl = leaf.view.containerEl.querySelector<HTMLElement>(selector);
          if (!linkEl) {
            throw new Error('The link is missing.');
          }
          await clickElement({ element: linkEl });
          let text = '';
          await waitUntil({
            message: 'The link did not open the CSV view.',
            predicate: () => {
              text = leaf.view.containerEl.querySelector(':scope .subpath-format-view')?.textContent ?? '';
              return leaf.view.getViewType() === constants.CSV_VIEW_TYPE && text !== '';
            },
            timeoutInMilliseconds: 10_000
          });
          return { text, viewType: leaf.view.getViewType() };
        } finally {
          leaf.detach();
        }
      },
      input: { constants: { CSV_VIEW_TYPE, LINK, NOTE_PATH } }
    });

    expect(result).toEqual({ text: 'row 2: banana,2', viewType: CSV_VIEW_TYPE });
  });

  it('should re-resolve an embed when its file changes', async () => {
    const result = await evalInObsidian({
      // Under the transport's ~30s per-closure cap, not at it. Two 10 s waits: the render, then the edit.
      async callback({ app, constants, lib: { waitUntil } }): Promise<string> {
        const note = app.vault.getFileByPath(constants.NOTE_PATH);
        const data = app.vault.getFileByPath(`${constants.FOLDER}/data.csv`);
        if (!note || !data) {
          throw new Error('The fixture is not set up.');
        }
        const original = await app.vault.read(data);
        const leaf = app.workspace.getLeaf('tab');
        try {
          await leaf.openFile(note, { active: true, state: { mode: 'preview' } });
          function readFirst(): string {
            return leaf.view.containerEl.querySelector(':scope .markdown-reading-view .subpath-format-embed[data-subpath="#row=2"]')?.textContent ?? '';
          }
          await waitUntil({ message: 'The embed did not render.', predicate: () => readFirst() !== '', timeoutInMilliseconds: 10_000 });
          // A row inserted above the target moves what `#row=2` points at: row numbers are positions, not identities.
          await app.vault.modify(data, original.replace('apple,1\n', 'apple,1\navocado,5\n'));
          await waitUntil({
            message: 'The embed did not follow the edit.',
            predicate: () => readFirst() === 'row 2: avocado,5',
            timeoutInMilliseconds: 10_000
          });
          return readFirst();
        } finally {
          leaf.detach();
          await app.vault.modify(data, original);
        }
      },
      input: { constants: { FOLDER, NOTE_PATH } }
    });

    expect(result).toBe('row 2: avocado,5');
  });

  it('should fall back to the generic file embed after unload and resolve again after a reload', async () => {
    const result = await evalInObsidian({
      // Under the transport's ~30s per-closure cap, not at it. Two 10 s waits: one render per registration state.
      async callback({ app, constants, lib: { waitUntil } }): Promise<UnloadResult> {
        const fixture = window.__subpathFormatFixture;
        const note = app.vault.getFileByPath(constants.NOTE_PATH);
        if (!fixture || !note) {
          throw new Error('The fixture is not set up.');
        }
        const noteFile: TFile = note;
        const leaves: WorkspaceLeaf[] = [];
        async function render(): Promise<HTMLElement> {
          const leaf = app.workspace.getLeaf('tab');
          leaves.push(leaf);
          await leaf.openFile(noteFile, { active: true, state: { mode: 'preview' } });
          return leaf.view.containerEl;
        }
        const loadedSelector = ':scope .markdown-reading-view .internal-embed.is-loaded';
        const ownSelector = ':scope .subpath-format-embed';

        try {
          fixture.unloadEmbeds();
          const isRegisteredAfterUnload = app.embedRegistry.isExtensionRegistered('csv') || app.embedRegistry.isExtensionRegistered('py');
          const unloadedEl = await render();
          await waitUntil({
            message: 'The generic file embeds did not render.',
            predicate: () => unloadedEl.querySelectorAll(loadedSelector).length >= constants.count,
            timeoutInMilliseconds: 10_000
          });
          const unloadedLoaded = unloadedEl.querySelectorAll(loadedSelector).length;
          const unloadedOwn = unloadedEl.querySelectorAll(ownSelector).length;

          fixture.loadEmbeds();
          const reloadedEl = await render();
          await waitUntil({
            message: 'The embeds did not render after the reload.',
            predicate: () => reloadedEl.querySelectorAll(ownSelector).length === constants.count,
            timeoutInMilliseconds: 10_000
          });
          return { afterReload: reloadedEl.querySelectorAll(ownSelector).length, isRegisteredAfterUnload, unloadedLoaded, unloadedOwn };
        } finally {
          fixture.loadEmbeds();
          for (const leaf of leaves) {
            leaf.detach();
          }
        }
      },
      input: { constants: { count: EXPECTED_EMBEDS.length, NOTE_PATH } }
    });

    // The ten embeds of existing files plus the one of the missing file, all loaded by Obsidian's own embeds.
    expect(result).toEqual({ afterReload: 10, isRegisteredAfterUnload: false, unloadedLoaded: 11, unloadedOwn: 0 });
  });

  it('should leave a format registered by someone else in place when a registration conflicts', async () => {
    const result = await evalInObsidian({
      callback({ app, lib: { EmbedExtensionsComponent } }): ConflictResult {
        const competitor = new EmbedExtensionsComponent(app);
        competitor.load();
        let message = '';
        try {
          competitor.registerExtensions(['tsv', 'csv'], () => {
            throw new Error('The competing creator must never run.');
          });
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }
        const isTsvRegistered = app.embedRegistry.isExtensionRegistered('tsv');
        competitor.unload();
        return { isCsvStillOwned: app.embedRegistry.isExtensionRegistered('csv'), isTsvRegistered, message };
      }
    });

    expect(result).toEqual({
      isCsvStillOwned: true,
      isTsvRegistered: false,
      message: 'Attempting to register an embed for an already registered extension "csv"'
    });
  });
});
