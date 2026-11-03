---
title: Broken-link candidates
description: Find possible replacements for missing link targets from a vault snapshot and git rename history.
---

`BrokenLinkCandidateFinder` works on paths and metadata supplied by the caller, on desktop and mobile. It reads no files and changes no links. Build a new finder when the snapshot changes.

```ts
import { BrokenLinkCandidateFinder } from '@mnaoumov/obsidian-lib/broken-link-candidates';

const finder = new BrokenLinkCandidateFinder({
  aliasesByPath: new Map([['Notes/New name.md', ['Old name']]]),
  filePaths: ['Notes/New name.md'],
  folderNoteFileNames: ['index.md'],
  gitRenames: new Map(),
  titlesByPath: new Map()
});
const candidates = finder.findAll(['Notes/Old name.md']);
console.log(candidates.get('Notes/Old name.md'));
```

Pass vault-relative paths with `/` separators. Supply all missing targets together: detecting a renamed folder depends on every missing target beneath it appearing under the same sibling folder. Folder-note names are caller-defined; their aliases and titles match the old folder name, and same-name matches must also share a parent-folder name.

Candidates carry descriptions and evidence kinds, ordered by git rename, case change, alias, title, renamed folder, then same name with the longest matching parent suffix. Equal-strength candidates are sorted by path. The finder preserves ambiguity: the caller decides whether to offer a repair, and should require exactly one candidate before offering a one-click fix. `getPathMapping(oldPath, newPath)` returns the differing prefixes for a related batch repair; `getParentPath(path)` returns the parent or an empty string for the vault root.

## Optional git evidence

`loadGitRenames` from `@mnaoumov/obsidian-lib/git-rename-history` accepts an injected `runGit` function. It follows rename chains, restricts paths to the vault's repository prefix, and returns an empty map if git cannot run. `parseGitRenameLog` also accepts an already captured log, so parsing needs no desktop APIs.

```ts
import { Platform } from 'obsidian';
import { loadGitRenames } from '@mnaoumov/obsidian-lib/git-rename-history';

if (Platform.isDesktopApp) {
  const { createDesktopGitRunner } = await import('@mnaoumov/obsidian-lib/desktop-git-runner');
  const gitRenames = await loadGitRenames({ runGit: createDesktopGitRunner('C:/My vault') });
  console.log(gitRenames);
}
```

The desktop runner uses the system `git` executable, with Node imports deferred until a command runs. Guard execution with `Platform.isDesktopApp`; on mobile pass an empty map or evidence obtained elsewhere.
