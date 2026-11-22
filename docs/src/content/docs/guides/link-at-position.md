---
title: Link at the cursor
description: Find the link under the editor cursor, in the body and in the frontmatter, inclusive at both ends of the link.
---

A command that acts on "the link under the cursor" has to decide where a link starts and ends. Obsidian's `Editor.getClickableTokenAt` is the obvious answer, but it misses a cursor that sits right before a link (`{cursor}[alias](url)`), and it reports nothing inside the frontmatter. `@mnaoumov/obsidian-lib/link-at-position` answers the same question with one rule for every place a link can be.

## Find the link

`getLinkAtEditorPosition` reads the editor's lines and returns the link at the cursor, or `null`. Pass `position` to look somewhere else.

<!-- snippet-check: context declare const editor: import('obsidian').Editor; -->

```ts
import {
  getLinkAtEditorPosition,
  getLinkAtPositionTarget
} from '@mnaoumov/obsidian-lib/link-at-position';

const link = getLinkAtEditorPosition({ editor });
if (link) {
  console.log(link.parseLinkResult.raw, link.linkPath, link.subpath, link.line, link.startCh, link.endCh);
  const target = getLinkAtPositionTarget({ app, link, sourcePath: file.path });
  console.log(target?.path ?? 'unresolved or external');
}
```

The result carries the parsed link (`parseLinkResult`, whose flags tell a wikilink, an embed and an external link apart), the link path and subpath, the line, the columns of the link's raw text (`startCh`, `endCh`) and the columns of the range that hits it (`rangeStartCh`, `rangeEndCh`). `getLinkAtPositionTarget` resolves an internal link through `metadataCache.getFirstLinkpathDest`; a link into the same note (`[[#Heading]]`) resolves to that note, and an external link to `null`.

`getLinkAtPosition({ lines, position })` is the same lookup over anything with `getLine` and `lineCount`, for a caller that holds the text rather than an editor.

## The rules in the body

1. A link is hit from its first character to just past its last, both included: `{cursor}[a](b)`, `[a{cursor}](b)` and `[a](b){cursor}` all find `[a](b)`.
2. When two links touch, `[a](x){cursor}[b](y)`, the one the cursor is before wins.
3. A line inside a fenced code block, or a fence line, holds no link. So does inline code.
4. Indentation is ignored, so a nested list item is not read as an indented code block.

## The rules in the frontmatter

1. The quotes belong to the link. In `key: "[[note]]"`, a cursor on either quote finds `[[note]]`. Unquoted values, single-quoted values, flow sequences (`key: ["[[a]]", "[[b]]"]`), block sequence items and Markdown links (`key: "[alias](url)"`) follow the same rule.
2. A cursor on the key, the sequence dash, the indentation or the gap before the value finds the value's link only when the value holds exactly one. A key with an empty value counts the links on its nested lines. With several links nothing says which one is meant, so the answer is `null`.
3. In a flow sequence, the commas and spaces between two entries find the entry after them.
4. A comment holds no link, and neither do the `---` lines.
5. `frontmatterKey` is the dotted path of the block-mapping keys that own the link (`parent.child`). A key inside a flow mapping is not part of it.

The positions are those of the YAML source text, so they exist in Source mode. In Live Preview the frontmatter is the Properties widget, which the cursor cannot enter, so there is no editor position to look up there.

## Limits

Links are found one line at a time, so a link never spans two lines. Bare `www.` literals are links in the body but not in the frontmatter, as in Obsidian.
