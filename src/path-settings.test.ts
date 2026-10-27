import {
  describe,
  expect,
  it
} from 'vitest';

import {
  PathSettings,
  pathsValidator
} from './path-settings.ts';

const REPORTED_REG_EXP = String.raw`/^Inbox\/[^\/]*$/`;
const DANGLING_ESCAPE = String.raw`/^Inbox\/`;
const UNBALANCED_CHARACTER_CLASS = String.raw`/^Inbox\/[^\/`;
const UNBALANCED_GROUP = '/(Inbox/';

describe('PathSettings', () => {
  describe('excludePaths', () => {
    it('should not ignore any paths by default', () => {
      const ps = new PathSettings();
      expect(ps.isPathIgnored('some/path')).toBe(false);
    });

    it('should ignore paths matching exclude patterns', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['secret'];
      expect(ps.isPathIgnored('secret')).toBe(true);
      expect(ps.isPathIgnored('secret/file.md')).toBe(true);
      expect(ps.isPathIgnored('other/path')).toBe(false);
    });

    it('should filter out empty strings from arrays', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['', 'dir', ''];
      expect(ps.excludePaths).toEqual(['dir']);
    });

    it('should return the set array via getter', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['a', 'b'];
      expect(ps.excludePaths).toEqual(['a', 'b']);
    });

    it('should reset to default when set to empty array', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['secret'];
      expect(ps.isPathIgnored('secret')).toBe(true);
      ps.excludePaths = [];
      expect(ps.isPathIgnored('secret')).toBe(false);
    });
  });

  describe('includePaths', () => {
    it('should include all paths by default', () => {
      const ps = new PathSettings();
      expect(ps.isPathIgnored('anything')).toBe(false);
    });

    it('should ignore paths not matching include patterns', () => {
      const ps = new PathSettings();
      ps.includePaths = ['allowed'];
      expect(ps.isPathIgnored('allowed')).toBe(false);
      expect(ps.isPathIgnored('allowed/file.md')).toBe(false);
      expect(ps.isPathIgnored('other')).toBe(true);
    });

    it('should return the set array via getter', () => {
      const ps = new PathSettings();
      ps.includePaths = ['x', 'y'];
      expect(ps.includePaths).toEqual(['x', 'y']);
    });
  });

  describe('combined include/exclude', () => {
    it('should ignore paths excluded even if included', () => {
      const ps = new PathSettings();
      ps.includePaths = ['project'];
      ps.excludePaths = ['project/secret'];
      expect(ps.isPathIgnored('project/public')).toBe(false);
      expect(ps.isPathIgnored('project/secret')).toBe(true);
      expect(ps.isPathIgnored('other')).toBe(true);
    });
  });

  describe('regex path patterns', () => {
    it('should support regex patterns delimited by slashes', () => {
      const ps = new PathSettings();
      ps.excludePaths = [String.raw`/\.git/`];
      expect(ps.isPathIgnored('.git')).toBe(true);
      expect(ps.isPathIgnored('foo/.git/bar')).toBe(true);
      expect(ps.isPathIgnored('xgit')).toBe(false);
    });

    it('should treat "/" as default pattern for exclude (never match)', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['/'];
      expect(ps.isPathIgnored('anything')).toBe(false);
    });

    it('should treat "/" as default pattern for include (always match)', () => {
      const ps = new PathSettings();
      ps.includePaths = ['/'];
      expect(ps.isPathIgnored('anything')).toBe(false);
    });

    it('should strip trailing slashes from plain paths', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['dir/'];
      expect(ps.isPathIgnored('dir')).toBe(true);
      expect(ps.isPathIgnored('dir/file')).toBe(true);
    });
  });

  describe('path matching details', () => {
    it('should match exact path or path with slash suffix', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['folder'];
      expect(ps.isPathIgnored('folder')).toBe(true);
      expect(ps.isPathIgnored('folder/sub')).toBe(true);
      expect(ps.isPathIgnored('folderx')).toBe(false);
    });

    it('should handle multiple exclude paths', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['a', 'b'];
      expect(ps.isPathIgnored('a')).toBe(true);
      expect(ps.isPathIgnored('b')).toBe(true);
      expect(ps.isPathIgnored('c')).toBe(false);
    });

    it('should handle multiple include paths', () => {
      const ps = new PathSettings();
      ps.includePaths = ['a', 'b'];
      expect(ps.isPathIgnored('a')).toBe(false);
      expect(ps.isPathIgnored('b')).toBe(false);
      expect(ps.isPathIgnored('c')).toBe(true);
    });

    it('should handle special regex characters in paths', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['dir.name'];
      expect(ps.isPathIgnored('dir.name')).toBe(true);
      expect(ps.isPathIgnored('dirxname')).toBe(false);
    });
  });

  describe('case-insensitive matching', () => {
    it('should match plain paths case-insensitively', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['Secret'];
      expect(ps.isPathIgnored('secret/note.md')).toBe(true);
      expect(ps.isPathIgnored('SECRET')).toBe(true);
    });

    it('should match globs case-insensitively', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['*.pdf'];
      expect(ps.isPathIgnored('a/b/C.PDF')).toBe(true);
    });

    it('should match regular expressions case-insensitively', () => {
      const ps = new PathSettings();
      ps.excludePaths = [String.raw`/\.locked$/`];
      expect(ps.isPathIgnored('note.LOCKED')).toBe(true);
    });
  });

  describe('regular expression flags', () => {
    it('should honour a regular expression with flags', () => {
      const ps = new PathSettings();
      ps.excludePaths = [String.raw`/\.locked$/i`];
      expect(ps.isPathIgnored('folder/note.locked')).toBe(true);
      expect(ps.isPathIgnored('folder/note.md')).toBe(false);
    });

    it('should honour the s flag', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['/^a.b$/s'];
      expect(ps.isPathIgnored('a\nb')).toBe(true);
    });

    it('should drop the stateful g and y flags so repeated matches agree', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['/note/gy'];
      expect(ps.isPathIgnored('note.md')).toBe(true);
      expect(ps.isPathIgnored('note.md')).toBe(true);
    });

    it.each(['/note/x', '/note/ii'])('should fall back to the default pattern for invalid flags in %s', (entry) => {
      const ps = new PathSettings();
      ps.excludePaths = [entry];
      expect(ps.isPathIgnored('note.md')).toBe(false);
    });
  });

  describe('glob patterns', () => {
    it('should match a name-only glob at any depth', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['*.pdf'];
      expect(ps.isPathIgnored('c.pdf')).toBe(true);
      expect(ps.isPathIgnored('a/b/c.pdf')).toBe(true);
      expect(ps.isPathIgnored('a/b/c.pdf.md')).toBe(false);
      expect(ps.isPathIgnored('a/b/c.md')).toBe(false);
    });

    it('should match everything inside a folder whose name matches', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['tmp*'];
      expect(ps.isPathIgnored('a/tmp1/note.md')).toBe(true);
    });

    it('should anchor a glob with a slash to the vault root', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['Attachments/*.pdf'];
      expect(ps.isPathIgnored('Attachments/c.pdf')).toBe(true);
      expect(ps.isPathIgnored('Notes/Attachments/c.pdf')).toBe(false);
      expect(ps.isPathIgnored('Attachments/sub/c.pdf')).toBe(false);
    });

    it('should match across segments with **', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['Attachments/**/*.pdf'];
      expect(ps.isPathIgnored('Attachments/c.pdf')).toBe(true);
      expect(ps.isPathIgnored('Attachments/a/b/c.pdf')).toBe(true);
      expect(ps.isPathIgnored('Other/a/c.pdf')).toBe(false);
    });

    it('should match everything inside a folder with a trailing /**', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['Archive/**'];
      expect(ps.isPathIgnored('Archive/a/b.md')).toBe(true);
      expect(ps.isPathIgnored('Archive')).toBe(false);
    });

    it('should treat ** inside a segment as an ordinary *', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['a/b**c'];
      expect(ps.isPathIgnored('a/basic')).toBe(true);
      expect(ps.isPathIgnored('a/b/c')).toBe(false);
    });

    it('should treat ** at the end of a segment that is not the last as an ordinary *', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['a/b**'];
      expect(ps.isPathIgnored('a/bxx')).toBe(true);
    });

    it('should match one character with ?', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['note?.md'];
      expect(ps.isPathIgnored('note1.md')).toBe(true);
      expect(ps.isPathIgnored('note12.md')).toBe(false);
      expect(ps.isPathIgnored('note/.md')).toBe(false);
    });

    it('should match a character class', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['note[0-9].md'];
      expect(ps.isPathIgnored('note5.md')).toBe(true);
      expect(ps.isPathIgnored('noteA.md')).toBe(false);
    });

    it.each(['note[!0-9].md', 'note[^0-9].md'])('should match a negated character class %s', (entry) => {
      const ps = new PathSettings();
      ps.excludePaths = [entry];
      expect(ps.isPathIgnored('noteA.md')).toBe(true);
      expect(ps.isPathIgnored('note5.md')).toBe(false);
    });

    it('should treat a leading ] in a character class as literal', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['note[]A].md'];
      expect(ps.isPathIgnored('note].md')).toBe(true);
      expect(ps.isPathIgnored('noteA.md')).toBe(true);
      expect(ps.isPathIgnored('noteB.md')).toBe(false);
    });

    it('should honour escapes and special characters inside a character class', () => {
      const ps = new PathSettings();
      ps.excludePaths = [String.raw`note[\*^\\].md`];
      expect(ps.isPathIgnored('note*.md')).toBe(true);
      expect(ps.isPathIgnored('note^.md')).toBe(true);
      expect(ps.isPathIgnored(String.raw`note\.md`)).toBe(true);
      expect(ps.isPathIgnored('noteA.md')).toBe(false);
    });

    it('should match an escaped glob character literally', () => {
      const ps = new PathSettings();
      ps.excludePaths = [String.raw`a\*b*`];
      expect(ps.isPathIgnored('a*bc')).toBe(true);
      expect(ps.isPathIgnored('abc')).toBe(false);
    });

    it('should match a folder-only glob against folders and their contents', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['tmp*/'];
      expect(ps.isPathIgnored('a/tmp1', true)).toBe(true);
      expect(ps.isPathIgnored('a/tmp1')).toBe(false);
      expect(ps.isPathIgnored('a/tmp1/note.md')).toBe(true);
    });

    it.each(['a*\\', 'note[0-9.md', 'note[0-9\\', 'note[z-a].md'])('should fall back to the default pattern for invalid glob %s', (entry) => {
      const ps = new PathSettings();
      ps.excludePaths = [entry];
      expect(ps.isPathIgnored('anything')).toBe(false);
    });
  });

  describe('escaped plain paths', () => {
    it('should match an escaped plain path literally', () => {
      const ps = new PathSettings();
      ps.excludePaths = [String.raw`Notes \[old\]`];
      expect(ps.isPathIgnored('Notes [old]/a.md')).toBe(true);
      expect(ps.isPathIgnored('Notes o')).toBe(false);
    });
  });

  describe('un-parseable regex patterns', () => {
    it('should not throw for any prefix typed on the way to a valid regex', () => {
      const ps = new PathSettings();
      for (let length = 1; length <= REPORTED_REG_EXP.length; length++) {
        const prefix = REPORTED_REG_EXP.slice(0, length);
        expect(() => {
          ps.excludePaths = [prefix];
        }, prefix).not.toThrow();
      }
    });

    it('should match as usual once the typed regex is completed', () => {
      const ps = new PathSettings();
      ps.excludePaths = [REPORTED_REG_EXP];
      expect(ps.isPathIgnored('Inbox/note.md')).toBe(true);
      expect(ps.isPathIgnored('Inbox/sub/note.md')).toBe(false);
      expect(ps.isPathIgnored('Other/note.md')).toBe(false);
    });

    it.each([DANGLING_ESCAPE, UNBALANCED_CHARACTER_CLASS, UNBALANCED_GROUP])('should exclude nothing for un-parseable exclude pattern %s', (path) => {
      const ps = new PathSettings();
      ps.excludePaths = [path];
      expect(ps.isPathIgnored('Inbox/note.md')).toBe(false);
      expect(ps.isPathIgnored('anything')).toBe(false);
    });

    it.each([DANGLING_ESCAPE, UNBALANCED_CHARACTER_CLASS, UNBALANCED_GROUP])('should include everything for un-parseable include pattern %s', (path) => {
      const ps = new PathSettings();
      ps.includePaths = [path];
      expect(ps.isPathIgnored('Inbox/note.md')).toBe(false);
      expect(ps.isPathIgnored('anything')).toBe(false);
    });

    it('should fall back to the default pattern when only some entries are un-parseable', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['secret', DANGLING_ESCAPE];
      expect(ps.isPathIgnored('secret')).toBe(false);
    });

    it('should keep the entries as set', () => {
      const ps = new PathSettings();
      ps.excludePaths = ['secret', DANGLING_ESCAPE];
      expect(ps.excludePaths).toEqual(['secret', DANGLING_ESCAPE]);
    });

    it('should not throw when the same un-parseable value is assigned again', () => {
      const ps = new PathSettings();
      ps.excludePaths = [DANGLING_ESCAPE];
      const savedPaths = ps.excludePaths;
      expect(() => {
        ps.excludePaths = savedPaths;
      }).not.toThrow();
    });

    it('should recover once an un-parseable value is replaced with a valid one', () => {
      const ps = new PathSettings();
      ps.excludePaths = [DANGLING_ESCAPE];
      expect(ps.isPathIgnored('secret')).toBe(false);
      ps.excludePaths = ['secret'];
      expect(ps.isPathIgnored('secret')).toBe(true);
    });
  });
});

describe('pathsValidator', () => {
  it('should accept an empty array', () => {
    expect(pathsValidator([])).toBeUndefined();
  });

  it('should accept plain paths', () => {
    expect(pathsValidator(['dir', 'dir/sub', 'dir.name'])).toBeUndefined();
  });

  it('should accept valid regex patterns', () => {
    expect(pathsValidator([REPORTED_REG_EXP, String.raw`/\.git/`, '/'])).toBeUndefined();
  });

  it.each([DANGLING_ESCAPE, UNBALANCED_CHARACTER_CLASS, UNBALANCED_GROUP])('should reject un-parseable regex pattern %s', (path) => {
    expect(pathsValidator([path])).toContain(path);
  });

  it('should report the first un-parseable entry', () => {
    expect(pathsValidator(['dir', UNBALANCED_GROUP, DANGLING_ESCAPE])).toContain(UNBALANCED_GROUP);
  });

  it('should report the reason a regular expression is invalid', () => {
    expect(pathsValidator([DANGLING_ESCAPE])).toBe(String.raw`Invalid regular expression: /^Inbox\/ (\ at end of pattern)`);
  });

  it('should report an invalid regular expression flag', () => {
    expect(pathsValidator(['/note/x'])).toContain('/note/x');
  });

  it('should accept valid globs and flags', () => {
    expect(pathsValidator(['*.pdf', 'Attachments/**/*.pdf', 'tmp*/', String.raw`/\.locked$/i`])).toBeUndefined();
  });

  it.each([
    ['a*\\', String.raw`Invalid glob pattern: a*\ (it ends with an unescaped \)`],
    ['note[0-9.md', 'Invalid glob pattern: note[0-9.md (a [ character class is never closed with ])'],
    ['note[z-a].md', 'Invalid glob pattern: note[z-a].md (Range out of order in character class)']
  ])('should report invalid glob %s with its reason', (entry, message) => {
    expect(pathsValidator([entry])).toBe(message);
  });
});
