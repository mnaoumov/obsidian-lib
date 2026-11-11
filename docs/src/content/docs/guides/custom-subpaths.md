---
title: Custom subpaths for non-Markdown files
description: Let a file format answer its own link subpaths, such as a CSV row or a code symbol, in embeds, hover previews and link navigation.
---

A link to a non-Markdown file can carry a subpath that only that format understands: `[[data.csv#row=2]]`, `![[data.csv#rows=2-3]]` or `![[lib.py#greet]]`. Obsidian does not interpret it. It parses the link text, resolves the file, and passes the subpath, with its leading `#`, to whichever code owns the file's extension. So a format provider needs no new registry. It needs one resolver and two registrations that already exist: an embed creator and a file view.

## How the subpath reaches the format

Read from Obsidian `1.15.1`, the latest public and Catalyst release when this was written. The integration tests beside `EmbedExtensionsComponent` pin every row except the canvas one, which was only read from the bundle:

| Surface | Path into the provider | What it receives |
| --- | --- | --- |
| `![[file.ext#target]]` in Reading view | The embed loader calls `embedRegistry.getEmbedCreator(file)` | `(context, file, '#target')` |
| The same embed in Live Preview | The same loader, from the editor's embed widget | `(context, file, '#target')` |
| Canvas file node | The same loader | `(context, file, '#target')` |
| Page-preview hover over `[[file.ext#target]]` | The hover popover loads the link as an embed | `(context, file, '#target')` |
| Click, or Mod-click, on `[[file.ext#target]]` | `openLinkText` opens the file in the view registered for the extension | `setEphemeralState({ subpath: '#target' })` |

So the embed creator answers every rendering surface and the view answers navigation. Both receive the same string, so a single resolver serves both. Three behaviors follow from the loader:

1. **A link to a missing file never reaches the provider.** Obsidian renders its own empty-file embed.
2. **A creator may return `null`** to decline a file, and Obsidian then renders its generic file embed. The `obsidian-typings` signature does not admit `null` yet, so returning it needs a cast.
3. **The subpath is passed as written, and is not decoded.** A wikilink and a Markdown embed (`![](data.csv#row=1)`) deliver the same `#row=1`, but a Markdown destination written percent-encoded, `![](data.csv#row%3D1)`, arrives as `#row%3D1`. Keep the syntax to characters that need no escaping in either form (no spaces, and no `#`, `|`, `[`, `]` or `%` inside the target), or decode in the resolver and say so in the format's documentation. The integration test pins the encoded form.

## The recipe

Write one pure resolver per format, then register an embed creator through `EmbedExtensionsComponent` and a view through the plugin. The resolver never touches the DOM, which keeps its rules for malformed, missing and ambiguous targets in one tested place.

<!-- snippet-check: context declare const plugin: import('obsidian').Plugin; -->
```ts
import type { EmbedComponent } from '@obsidian-typings/obsidian-public-latest';

import { EmbedExtensionsComponent } from '@mnaoumov/obsidian-lib/components/embed-extensions-component';
import {
  Component,
  FileView,
  TFile
} from 'obsidian';

type CsvTarget =
  | { kind: 'invalid' | 'missing' }
  | { kind: 'rows'; rows: string[] }
  | { kind: 'whole' };

function resolveCsvTarget(content: string, subpath: string): CsvTarget {
  if (!subpath) {
    return { kind: 'whole' };
  }
  const match = /^#rows?=(?<from>\d+)(?:-(?<to>\d+))?$/.exec(subpath);
  if (!match?.groups) {
    return { kind: 'invalid' };
  }
  const from = Number(match.groups['from']);
  const to = match.groups['to'] === undefined ? from : Number(match.groups['to']);
  const rows = content.split('\n').slice(1).filter((line) => line !== '');
  return from < 1 || to < from || to > rows.length ? { kind: 'missing' } : { kind: 'rows', rows: rows.slice(from - 1, to) };
}

function describe(target: CsvTarget): string {
  return target.kind === 'rows' ? target.rows.join('\n') : target.kind;
}

class CsvEmbed extends Component implements EmbedComponent {
  public constructor(private readonly containerEl: HTMLElement, private readonly file: TFile, private readonly subpath: string) {
    super();
  }

  public async loadFile(): Promise<void> {
    await this.render();
  }

  public override onload(): void {
    // Re-resolve after an edit: a row number is a position, so the same link may now point at another row.
    this.registerEvent(app.vault.on('modify', (changed) => {
      if (changed === this.file) {
        void this.render();
      }
    }));
  }

  private async render(): Promise<void> {
    const text = describe(resolveCsvTarget(await app.vault.cachedRead(this.file), this.subpath));
    this.containerEl.empty();
    this.containerEl.createEl('pre', { text });
  }
}

class CsvView extends FileView {
  private subpath = '';

  public override getViewType(): string {
    return 'my-plugin-csv';
  }

  public override async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
    await this.render();
  }

  public override setEphemeralState(state: unknown): void {
    super.setEphemeralState(state);
    if (typeof state === 'object' && state !== null && 'subpath' in state && typeof state.subpath === 'string') {
      this.subpath = state.subpath;
      void this.render();
    }
  }

  private async render(): Promise<void> {
    if (!this.file) {
      return;
    }
    const text = describe(resolveCsvTarget(await app.vault.cachedRead(this.file), this.subpath));
    this.contentEl.empty();
    this.contentEl.createEl('pre', { text });
  }
}

plugin.registerView('my-plugin-csv', (leaf) => new CsvView(leaf));
plugin.registerExtensions(['csv'], 'my-plugin-csv');

const embeds = plugin.addChild(new EmbedExtensionsComponent(plugin.app));
embeds.registerExtensions(['csv'], (context, embeddedFile, subpath) => new CsvEmbed(context.containerEl, embeddedFile, subpath ?? ''));
```

A code-symbol format is the same shape with a different resolver: `#greet` matches the one `def greet` or `class greet` line, a name defined twice is ambiguous rather than silently the first match, and a name that is not a valid identifier is malformed. The integration tests carry both resolvers.

## Ownership and lifecycle

1. **One owner per extension.** Both registries throw when an extension is already registered, whether by Obsidian's core (Markdown, images, audio, video, PDF) or by another plugin. Never unregister someone else's extension to take it over. `EmbedExtensionsComponent.registerExtensions` is all or nothing: on a conflict it unregisters the extensions it registered in the same call and rethrows, so a plugin that catches the error is left owning nothing half-way.
2. **Unload hands the format back.** Unloading the component unregisters its extensions, and the next render falls back to Obsidian's generic file embed. A component loaded again registers again, so an embed rendered after a reload resolves through the provider.
3. **`plugin.registerView` and `plugin.registerExtensions` are unregistered when the plugin unloads**, not when a component does. Register them from the plugin, or from a component whose lifetime is the plugin's.

## Line numbers and renames

A row or line number is a position. An edit above the target moves what the same link points at, and the integration tests pin exactly that: inserting a row above `#row=2` makes the embed show the inserted row. Nothing in this recipe tracks a row or a symbol when its file changes, or rewrites a subpath when a row or symbol is renamed. A format that needs stable targets has to give its rows or symbols identities of their own (a key column, a symbol name) and resolve by those.

## The unofficial boundary

`app.embedRegistry` and the `EmbedCreator` / `EmbedComponent` / `EmbedContext` types are not part of `obsidian.d.ts`. They are typed by `obsidian-typings`, and their behavior here was read from Obsidian `1.15.1`. `FileView`, `setEphemeralState`, `registerView` and `registerExtensions` are official. The two integration test files, `embed-extensions-component.obsidian.integration.test.ts` (Reading view, Live Preview, the hover event, a click, edits, unload and reload, conflicts) and its `.desktop` sibling (a trusted hover and a Mod-click), turn red if a release changes the embed path.
