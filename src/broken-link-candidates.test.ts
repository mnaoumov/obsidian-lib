// The near-miss cases below misspell names on purpose.
// cspell:words Recpies Projetc kikoff Repices Projekts sitten kiten iktten wxyz abce
import {
  describe,
  expect,
  it
} from 'vitest';

import type {
  BrokenLinkCandidate,
  BrokenLinkCandidateFinderConstructorParams
} from './broken-link-candidates.ts';

import {
  BrokenLinkCandidateFinder,
  BrokenLinkEvidenceKind,
  getEditDistance,
  getNearMissMaxDistance,
  getParentPath,
  getPathMapping
} from './broken-link-candidates.ts';

function createFinder(params: Partial<BrokenLinkCandidateFinderConstructorParams>): BrokenLinkCandidateFinder {
  return new BrokenLinkCandidateFinder({
    aliasesByPath: new Map(),
    filePaths: [],
    folderNoteFileNames: [],
    gitRenames: new Map(),
    titlesByPath: new Map(),
    ...params
  });
}

function find(finder: BrokenLinkCandidateFinder, missingPath: string): BrokenLinkCandidate[] {
  return finder.findAll([missingPath]).get(missingPath) ?? [];
}

function kinds(candidate: BrokenLinkCandidate | undefined): BrokenLinkEvidenceKind[] {
  return candidate?.evidence.map((evidence) => evidence.kind) ?? [];
}

describe('BrokenLinkCandidateFinder', () => {
  it('should find nothing in an empty vault', () => {
    expect(find(createFinder({}), 'a/b.md')).toStrictEqual([]);
  });

  it('should find a file moved to another folder by its name', () => {
    const candidates = find(createFinder({ filePaths: ['x/b.md', 'x/other.md'] }), 'a/b.md');
    expect(candidates.map((candidate) => candidate.path)).toStrictEqual(['x/b.md']);
    // The top-level folder `a` is gone too, so `x` reads as its renamed sibling as well.
    expect(kinds(candidates[0])).toStrictEqual([BrokenLinkEvidenceKind.RenamedFolder, BrokenLinkEvidenceKind.SameName]);
    expect(candidates[0]?.evidence[1]?.description).toBe('It has the same name, "b.md", in another folder.');
  });

  it('should prefer the file that shares the longest run of parent folders', () => {
    const candidates = find(createFinder({ filePaths: ['x/c/b.md', 'y/b.md', 'z/c/b.md', 'w/d/c/b.md'] }), 'a/d/c/b.md');
    expect(candidates.map((candidate) => candidate.path)).toStrictEqual(['w/d/c/b.md']);
  });

  it('should list every file tied for the longest run, picking none', () => {
    const candidates = find(createFinder({ filePaths: ['x/c/b.md', 'z/c/b.md', 'y/b.md'] }), 'a/c/b.md');
    expect(candidates.map((candidate) => candidate.path)).toStrictEqual(['x/c/b.md', 'z/c/b.md']);
  });

  it('should require a folder note to share its folder name too', () => {
    const finder = createFinder({ filePaths: ['x/!.md', 'y/charlie/!.md'], folderNoteFileNames: ['!.md'] });
    expect(find(finder, 'a/charlie/!.md').map((candidate) => candidate.path)).toStrictEqual(['y/charlie/!.md']);
    expect(find(finder, 'a/delta/!.md')).toStrictEqual([]);
  });

  it('should find a case-only rename', () => {
    const candidates = find(createFinder({ filePaths: ['A/B.md'] }), 'a/b.md');
    expect(candidates.map((candidate) => candidate.path)).toStrictEqual(['A/B.md']);
    expect(kinds(candidates[0])).toStrictEqual([BrokenLinkEvidenceKind.CaseChange]);
  });

  it('should find a git rename whose target still exists, and ignore one whose target is gone', () => {
    const finder = createFinder({
      filePaths: ['new.md'],
      gitRenames: new Map([
        ['gone.md', { commit: 'abc1234', newPath: 'also-gone.md' }],
        ['old.md', { commit: 'abc1234', newPath: 'new.md' }]
      ])
    });
    const candidates = find(finder, 'old.md');
    expect(candidates).toStrictEqual([{
      evidence: [{ description: 'Git history records the rename, in commit abc1234.', kind: BrokenLinkEvidenceKind.GitRename }],
      path: 'new.md'
    }]);
    expect(find(finder, 'gone.md')).toStrictEqual([]);
  });

  it('should find a note whose aliases or title hold the old name', () => {
    const finder = createFinder({
      aliasesByPath: new Map([['deleted.md', ['old']], ['notes/new.md', ['Old']], ['notes/unrelated.md', ['Other']]]),
      filePaths: ['notes/new.md', 'notes/unrelated.md', 'notes/titled.md'],
      titlesByPath: new Map([['notes/new.md', 'something'], ['notes/titled.md', 'old']])
    });
    const candidates = find(finder, 'a/old.md');
    expect(candidates.map((candidate) => [candidate.path, kinds(candidate)])).toStrictEqual([
      ['notes/new.md', [BrokenLinkEvidenceKind.Alias]],
      ['notes/titled.md', [BrokenLinkEvidenceKind.Title]]
    ]);
  });

  it('should match a folder note alias against the folder name, among folder notes only', () => {
    const finder = createFinder({
      aliasesByPath: new Map([['bravo/delta/!.md', ['charlie']], ['charlie.md', ['charlie']]]),
      filePaths: ['bravo/delta/!.md', 'charlie.md'],
      folderNoteFileNames: ['!.md']
    });
    const candidates = find(finder, 'alpha/bravo/charlie/!.md');
    expect(candidates.map((candidate) => candidate.path)).toStrictEqual(['bravo/delta/!.md']);
  });

  it('should skip alias evidence for a root folder note and for a non-note target', () => {
    const finder = createFinder({
      aliasesByPath: new Map([['x.md', ['', 'image']]]),
      filePaths: ['x.md'],
      folderNoteFileNames: ['!.md']
    });
    expect(find(finder, '!.md')).toStrictEqual([]);
    expect(find(finder, 'image.png')).toStrictEqual([]);
  });

  it('should find a renamed folder whose sibling holds every missing file that was under it', () => {
    const finder = createFinder({
      filePaths: ['alpha/bravo/delta/!.md', 'alpha/bravo/delta/sub/x.md', 'alpha/bravo/echo/!.md', 'other.md'],
      folderNoteFileNames: ['!.md']
    });
    const missing = ['alpha/bravo/charlie/!.md', 'alpha/bravo/charlie/sub/x.md'];
    const result = finder.findAll(missing);
    expect(result.get('alpha/bravo/charlie/!.md')?.map((candidate) => [candidate.path, kinds(candidate)])).toStrictEqual([
      ['alpha/bravo/delta/!.md', [BrokenLinkEvidenceKind.RenamedFolder]]
    ]);
    expect(result.get('alpha/bravo/charlie/sub/x.md')?.[0]?.path).toBe('alpha/bravo/delta/sub/x.md');
    expect(result.get('alpha/bravo/charlie/sub/x.md')?.[0]?.evidence[0]?.description).toBe(
      'The folder "alpha/bravo/charlie" is gone, and its sibling "alpha/bravo/delta" holds all 2 missing files that were under it.'
    );
  });

  it('should list every sibling folder that could be the renamed one', () => {
    const finder = createFinder({ filePaths: ['bravo/delta/!.md', 'bravo/echo/!.md'] });
    const candidates = find(finder, 'bravo/charlie/!.md');
    expect(candidates.map((candidate) => candidate.path)).toStrictEqual(['bravo/delta/!.md', 'bravo/echo/!.md']);
    expect(candidates[0]?.evidence[0]?.description).toBe(
      'The folder "bravo/charlie" is gone, and its sibling "bravo/delta" holds the missing file that was under it.'
    );
  });

  it('should find a renamed top-level folder', () => {
    const candidates = find(createFinder({ filePaths: ['new/a.png'] }), 'old/a.png');
    expect(candidates.map((candidate) => [candidate.path, kinds(candidate)])).toStrictEqual([
      ['new/a.png', [BrokenLinkEvidenceKind.RenamedFolder, BrokenLinkEvidenceKind.SameName]]
    ]);
  });

  it('should not treat a file renamed inside an existing folder as a renamed folder', () => {
    expect(find(createFinder({ filePaths: ['a/new.md', 'b/x.md'] }), 'a/old.md')).toStrictEqual([]);
  });

  it('should merge the evidence for one file and list the strongest candidate first', () => {
    const finder = createFinder({
      aliasesByPath: new Map([['b/old.md', ['old']]]),
      filePaths: ['b/old.md', 'c/old.md'],
      gitRenames: new Map([['a/old.md', { commit: 'c0ffee1', newPath: 'c/old.md' }]])
    });
    const candidates = find(finder, 'a/old.md');
    expect(candidates.map((candidate) => [candidate.path, kinds(candidate)])).toStrictEqual([
      ['c/old.md', [BrokenLinkEvidenceKind.GitRename, BrokenLinkEvidenceKind.RenamedFolder, BrokenLinkEvidenceKind.SameName]],
      ['b/old.md', [BrokenLinkEvidenceKind.Alias, BrokenLinkEvidenceKind.RenamedFolder, BrokenLinkEvidenceKind.SameName]]
    ]);
  });

  it('should find a near-miss name, keeping only the nearest', () => {
    const finder = createFinder({ filePaths: ['a/Meeting notes.md', 'a/Meeting nots.md', 'b/Meetings notes.md', 'a/Meting nots.md'] });
    const candidates = find(finder, 'a/Meeting note.md');
    expect(candidates.map((candidate) => [candidate.path, kinds(candidate)])).toStrictEqual([
      ['a/Meeting notes.md', [BrokenLinkEvidenceKind.NearMiss]],
      ['a/Meeting nots.md', [BrokenLinkEvidenceKind.NearMiss]]
    ]);
    expect(candidates[0]?.evidence[0]?.description).toBe('Its name is one edit away from the missing name "Meeting note".');
  });

  it('should count a swap of two adjacent characters as one edit', () => {
    const candidates = find(createFinder({ filePaths: ['Recipes.md'] }), 'Recpies.md');
    expect(candidates.map((candidate) => candidate.path)).toStrictEqual(['Recipes.md']);
    expect(kinds(candidates[0])).toStrictEqual([BrokenLinkEvidenceKind.NearMiss]);
  });

  it('should allow two edits for a long name and none for a short one', () => {
    const candidates = find(createFinder({ filePaths: ['Project kickoff.md'] }), 'Projetc kikoff.md');
    expect(candidates.map((candidate) => candidate.path)).toStrictEqual(['Project kickoff.md']);
    expect(candidates[0]?.evidence[0]?.description).toBe('Its name is 2 edits away from the missing name "Projetc kikoff".');
    expect(find(createFinder({ filePaths: ['Recipes.md'] }), 'Repices2.md')).toStrictEqual([]);
    expect(find(createFinder({ filePaths: ['log.md', 'cat.md'] }), 'lag.md')).toStrictEqual([]);
  });

  it('should require the same extension, ignoring its letter case', () => {
    const finder = createFinder({ filePaths: ['Diagrams.PNG', 'Diagrams.md'] });
    expect(find(finder, 'Diagram.svg')).toStrictEqual([]);
    expect(find(finder, 'Diagram.png').map((candidate) => candidate.path)).toStrictEqual(['Diagrams.PNG']);
  });

  it('should not report the same name in another letter case as a near miss', () => {
    const candidates = find(createFinder({ filePaths: ['x/RECIPES.md'] }), 'y/Recipes.md');
    expect(candidates.flatMap((candidate) => kinds(candidate))).not.toContain(BrokenLinkEvidenceKind.NearMiss);
  });

  it('should compare a folder note by its folder name, among folder notes only', () => {
    const finder = createFinder({ filePaths: ['x/Projects/!.md', 'x/Projekts.md', '!.md'], folderNoteFileNames: ['!.md'] });
    expect(find(finder, 'x/Projekts/!.md').map((candidate) => [candidate.path, kinds(candidate)])).toStrictEqual([
      ['x/Projects/!.md', [BrokenLinkEvidenceKind.RenamedFolder, BrokenLinkEvidenceKind.NearMiss]]
    ]);
    // A folder name too short for a near miss finds nothing.
    expect(find(finder, 'y/!.md')).toStrictEqual([]);
  });

  it('should rank a near miss below every other evidence', () => {
    const candidates = find(createFinder({ filePaths: ['x/Recipes.md', 'z/Recipe.md'] }), 'z/Recipes.md');
    expect(candidates.map((candidate) => [candidate.path, kinds(candidate)])).toStrictEqual([
      ['x/Recipes.md', [BrokenLinkEvidenceKind.SameName]],
      ['z/Recipe.md', [BrokenLinkEvidenceKind.NearMiss]]
    ]);
  });

  it('should answer each missing path once, however often it is asked for', () => {
    const result = createFinder({ filePaths: ['x/b.md'] }).findAll(['a/b.md', 'a/b.md']);
    expect([...result.keys()]).toStrictEqual(['a/b.md']);
  });
});

describe('getEditDistance', () => {
  it('should count insertions, deletions, substitutions and adjacent swaps as one edit each', () => {
    expect(getEditDistance('kitten', 'kitten')).toBe(0);
    expect(getEditDistance('kitten', 'sitten')).toBe(1);
    expect(getEditDistance('kitten', 'kiten')).toBe(1);
    expect(getEditDistance('kitten', 'kittens')).toBe(1);
    expect(getEditDistance('kitten', 'iktten')).toBe(1);
    expect(getEditDistance('kitten', 'sitting')).toBe(3);
    expect(getEditDistance('', 'abc')).toBe(3);
  });

  it('should stop past the limit', () => {
    expect(getEditDistance('kitten', 'sitting', 1)).toBe(2);
    expect(getEditDistance('a', 'abcd', 2)).toBe(3);
    expect(getEditDistance('abcd', 'wxyz', 2)).toBe(3);
    expect(getEditDistance('abcd', 'abce', 1)).toBe(1);
  });
});

describe('getNearMissMaxDistance', () => {
  it('should allow no edit below four characters, one up to seven and two from eight', () => {
    expect([3, 4, 7, 8, 15, 16, 40].map((length) => getNearMissMaxDistance(length))).toStrictEqual([0, 1, 1, 2, 2, 2, 2]);
  });
});

describe('getPathMapping', () => {
  it('should drop the common trailing segments', () => {
    expect(getPathMapping('alpha/bravo/charlie/!.md', 'alpha/bravo/delta/!.md')).toStrictEqual({
      newPrefix: 'alpha/bravo/delta',
      oldPrefix: 'alpha/bravo/charlie'
    });
  });

  it('should answer the vault root as an empty prefix', () => {
    expect(getPathMapping('x.md', 'a/x.md')).toStrictEqual({ newPrefix: 'a', oldPrefix: '' });
  });

  it('should keep whole paths when even the names differ', () => {
    expect(getPathMapping('a/B.md', 'a/b.md')).toStrictEqual({ newPrefix: 'a/b.md', oldPrefix: 'a/B.md' });
  });
});

describe('getParentPath', () => {
  it('should answer the parent folder, and the empty string for the vault root', () => {
    expect(getParentPath('a/b/c.md')).toBe('a/b');
    expect(getParentPath('c.md')).toBe('');
  });
});
