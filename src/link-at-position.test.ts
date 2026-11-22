import type {
  App as AppOriginal,
  TFile as TFileOriginal
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  LinkAtPosition,
  LinkSourceLines
} from './link-at-position.ts';

import {
  getLinkAtEditorPosition,
  getLinkAtPosition,
  getLinkAtPositionTarget
} from './link-at-position.ts';

const CURSOR = '{cursor}';

interface Located {
  readonly ch: number;
  readonly line: number;
  readonly lines: LinkSourceLines;
}

function find(text: string): LinkAtPosition | null {
  const { ch, line, lines } = locate(text);
  return getLinkAtPosition({ lines, position: { ch, line } });
}

function locate(text: string): Located {
  const rawLines = text.split('\n');
  const line = rawLines.findIndex((rawLine) => rawLine.includes(CURSOR));
  const cursorLine = rawLines[line] ?? '';
  const ch = cursorLine.indexOf(CURSOR);
  rawLines[line] = cursorLine.replace(CURSOR, '');
  return { ch, line, lines: toLines(rawLines) };
}

function raw(text: string): null | string {
  return find(text)?.parseLinkResult.raw ?? null;
}

function toLines(rawLines: readonly string[]): LinkSourceLines {
  return {
    getLine: (line: number): string => rawLines[line] ?? '',
    lineCount: (): number => rawLines.length
  };
}

function withFrontmatter(yaml: string): string {
  return `---\n${yaml}\n---\nbody`;
}

describe('getLinkAtPosition in the body', () => {
  it.each([
    ['{cursor}[alias](url.md)', '[alias](url.md)'],
    ['[{cursor}alias](url.md)', '[alias](url.md)'],
    ['[alias](url.md){cursor}', '[alias](url.md)'],
    ['{cursor}[[note|alias]]', '[[note|alias]]'],
    ['[[note]]{cursor}', '[[note]]'],
    ['[[no{cursor}te]]', '[[note]]'],
    ['{cursor}![[image.png]]', '![[image.png]]'],
    ['![[image.png]]{cursor}', '![[image.png]]'],
    ['see {cursor}https://example.com now', 'https://example.com'],
    ['{cursor}[a](x)[b](y)', '[a](x)'],
    ['[a](x){cursor}[b](y)', '[b](y)'],
    ['[a](x)[b](y){cursor}', '[b](y)'],
    ['[a](x) {cursor} [b](y)', null],
    ['{cursor}text', null],
    ['\t- {cursor}[[nested]]', '[[nested]]'],
    ['        - [[deep]]{cursor}', '[[deep]]'],
    ['`[[co{cursor}de]]`', null]
  ])('%s -> %s', (text, expected) => {
    expect(raw(text)).toBe(expected);
  });

  it('reports the columns, the kind, the path and the subpath', () => {
    const link = find('x {cursor}![[note#Heading|alias]] y');
    expect(link).toMatchObject({
      endCh: 25,
      frontmatterKey: null,
      isInFrontmatter: false,
      line: 0,
      linkPath: 'note',
      rangeEndCh: 25,
      rangeStartCh: 2,
      startCh: 2,
      subpath: '#Heading'
    });
    expect(link?.parseLinkResult).toMatchObject({ alias: 'alias', isEmbed: true, isWikilink: true });
  });

  it('gives an external link its whole url as the path', () => {
    expect(find('{cursor}[a](https://example.com/#x)')).toMatchObject({ linkPath: 'https://example.com/#x', subpath: '' });
  });

  it('shifts the columns of an indented line', () => {
    expect(find('\t\t{cursor}[[x]]')).toMatchObject({ endCh: 7, startCh: 2 });
  });

  it('finds nothing inside a fenced code block or on its fence', () => {
    expect(raw('```\n{cursor}[[x]]\n```')).toBeNull();
    expect(raw('```md [[x]]{cursor}\n```')).toBeNull();
    expect(raw('~~~~\n```\n{cursor}[[x]]\n~~~~')).toBeNull();
  });

  it('finds links after a closed fence', () => {
    expect(raw('```\ncode\n```\n{cursor}[[x]]')).toBe('[[x]]');
    expect(raw('~~~\n~~~~\n{cursor}[[x]]')).toBe('[[x]]');
  });

  it('reads a body that follows a frontmatter', () => {
    expect(raw('---\na: b\n---\n```\n```\n{cursor}[[x]]')).toBe('[[x]]');
  });

  it('treats an unclosed frontmatter as body text', () => {
    expect(raw('---\n{cursor}[[x]]')).toBe('[[x]]');
  });

  it('returns null for a line out of range', () => {
    const lines = toLines(['[[x]]']);
    expect(getLinkAtPosition({ lines, position: { ch: 0, line: 1 } })).toBeNull();
    expect(getLinkAtPosition({ lines, position: { ch: 0, line: -1 } })).toBeNull();
  });
});

describe('getLinkAtPosition in the frontmatter', () => {
  it.each([
    ['key1: {cursor}"[[link]]"', '[[link]]'],
    ['key2: "[[link]]"{cursor}', '[[link]]'],
    ['key: "[[li{cursor}nk]]"', '[[link]]'],
    ['key3: [{cursor}"[[link1]]", "[[link2]]"]', '[[link1]]'],
    ['key3: ["[[link1]]"{cursor}, "[[link2]]"]', '[[link1]]'],
    ['key3: ["[[link1]]",{cursor} "[[link2]]"]', '[[link2]]'],
    ['key3: ["[[link1]]", {cursor}"[[link2]]"]', '[[link2]]'],
    ['key4:\n  - {cursor}"[[link3]]"', '[[link3]]'],
    ['key4:\n  {cursor}- "[[link3]]"', '[[link3]]'],
    ['{cursor}key5: "[[link]]"', '[[link]]'],
    ['ke{cursor}y6: "[[link]]"', '[[link]]'],
    ['key:{cursor} "[[link]]"', '[[link]]'],
    ['{cursor}key: ["[[a]]", "[[b]]"]', null],
    ['{cursor}key: "[[a]] and [[b]]"', null],
    ['key: {cursor}[[link]]', '[[link]]'],
    ['key: [[link]]{cursor}', '[[link]]'],
    ['key: {cursor}\'[[link]]\'', '[[link]]'],
    ['key: \'it\'\'s [[li{cursor}nk]]\'', '[[link]]'],
    ['key: "say \\"hi\\" [[li{cursor}nk]]"', '[[link]]'],
    ['key: {cursor}"[alias](https://example.com)"', '[alias](https://example.com)'],
    ['key: [alias](url.md){cursor}', '[alias](url.md)'],
    ['url: {cursor}https://example.com', 'https://example.com'],
    ['a: { b: {cursor}"[[x]]" }', '[[x]]'],
    ['key: "[[link]]" # {cursor}"[[other]]"', null],
    ['key: "[[link]]" # comment{cursor}', null],
    ['# {cursor}"[[commented]]"', null],
    ['key: "text [[a]] {cursor}more"', null],
    ['key: "two [[a]]{cursor} [[b]]"', '[[a]]'],
    ['key: www.example.com{cursor}', null],
    ['key: "[A [ B](t.md)"{cursor}', '[A [ B](t.md)']
  ])('%s -> %s', (yaml, expected) => {
    expect(raw(withFrontmatter(yaml))).toBe(expected);
  });

  it('counts the nested lines of a key with an empty value', () => {
    expect(raw(withFrontmatter('{cursor}key:\n  - "[[only]]"\nother: "[[x]]"'))).toBe('[[only]]');
    expect(raw(withFrontmatter('{cursor}key:\n- "[[only]]"'))).toBe('[[only]]');
    expect(raw(withFrontmatter('{cursor}key:\n  - "[[a]]"\n\n  - "[[b]]"'))).toBeNull();
    expect(raw(withFrontmatter('{cursor}key:\nother: "[[x]]"'))).toBeNull();
  });

  it('reports the line of a link found from its key', () => {
    expect(find(withFrontmatter('{cursor}key:\n  - "[[only]]"'))).toMatchObject({ frontmatterKey: 'key', line: 2, rangeStartCh: 4, startCh: 5 });
  });

  it('reports the quotes as the hit range and the link as the raw text', () => {
    expect(find(withFrontmatter('key: {cursor}"[[link]]"'))).toMatchObject({
      endCh: 14,
      isInFrontmatter: true,
      line: 1,
      linkPath: 'link',
      rangeEndCh: 15,
      rangeStartCh: 5,
      startCh: 6
    });
  });

  it('reports the dotted key path of nested block mappings', () => {
    const yaml = 'parent:\n  child:\n    - {cursor}"[[x]]"\n  sibling: y';
    expect(find(withFrontmatter(yaml))?.frontmatterKey).toBe('parent.child');
    expect(find(withFrontmatter('parent:\n  child: 1\n  other:\n    - {cursor}"[[x]]"'))?.frontmatterKey).toBe('parent.other');
    expect(find(withFrontmatter('items:\n  - name: {cursor}"[[x]]"'))?.frontmatterKey).toBe('items.name');
    expect(find(withFrontmatter('"quoted key": {cursor}"[[x]]"'))?.frontmatterKey).toBe('quoted key');
    expect(find(withFrontmatter('\'it\'\'s\': {cursor}"[[x]]"'))?.frontmatterKey).toBe('it\'s');
    expect(find(withFrontmatter('"say \\"x\\"": {cursor}"[[x]]"'))?.frontmatterKey).toBe('say "x"');
  });

  it('skips a key that has its own value when walking up', () => {
    expect(find(withFrontmatter('a: 1\n  - {cursor}"[[x]]"'))?.frontmatterKey).toBeNull();
    expect(find(withFrontmatter('top:\n  a: 1\n\n    - {cursor}"[[x]]"'))?.frontmatterKey).toBe('top');
  });

  it('reads a multi-line string', () => {
    expect(raw(withFrontmatter('key: "first [[a]]\n  then {cursor}[[b]] end"'))).toBe('[[b]]');
    expect(raw(withFrontmatter('key: "unclosed {cursor}[[a]]'))).toBe('[[a]]');
    expect(raw(withFrontmatter('key: {cursor}"[[a]]'))).toBeNull();
  });

  it('finds nothing on the delimiter lines', () => {
    expect(raw('{cursor}---\nkey: "[[x]]"\n---')).toBeNull();
    expect(raw('---\nkey: "[[x]]"\n---{cursor}')).toBeNull();
  });

  it('finds nothing in an empty value', () => {
    expect(raw(withFrontmatter('{cursor}key:'))).toBeNull();
    expect(raw(withFrontmatter('key: {cursor}'))).toBeNull();
  });
});

describe('getLinkAtEditorPosition', () => {
  it('defaults to the cursor', () => {
    const { ch, line, lines } = locate('a {cursor}[[x]]');
    const editor = { ...lines, getCursor: vi.fn(() => ({ ch, line })) };
    expect(getLinkAtEditorPosition({ editor })?.parseLinkResult.raw).toBe('[[x]]');
  });

  it('uses the given position', () => {
    const { lines } = locate('[[x]] [[y]]{cursor}');
    const editor = { ...lines, getCursor: vi.fn(() => ({ ch: 0, line: 0 })) };
    expect(getLinkAtEditorPosition({ editor, position: { ch: 11, line: 0 } })?.parseLinkResult.raw).toBe('[[y]]');
    expect(editor.getCursor).not.toHaveBeenCalled();
  });
});

describe('getLinkAtPositionTarget', () => {
  const sourceFile = castTo<TFileOriginal>({ path: 'source.md' });
  const targetFile = castTo<TFileOriginal>({ path: 'note.md' });
  const getFirstLinkpathDestination = vi.fn((linkPath: string) => linkPath === 'note' ? targetFile : null);
  const app = castTo<AppOriginal>({
    // eslint-disable-next-line unicorn/name-replacements -- Obsidian's own method name.
    metadataCache: { getFirstLinkpathDest: getFirstLinkpathDestination },
    vault: { getFileByPath: vi.fn((path: string) => path === 'source.md' ? sourceFile : null) }
  });

  function target(text: string): null | TFileOriginal {
    const link = find(text);
    if (!link) {
      throw new Error('No link');
    }
    return getLinkAtPositionTarget({ app, link, sourcePath: 'source.md' });
  }

  it('resolves an internal link', () => {
    expect(target('{cursor}[[note#Heading]]')).toBe(targetFile);
  });

  it('resolves a link into the same note to that note', () => {
    expect(target('{cursor}[[#Heading]]')).toBe(sourceFile);
  });

  it('returns null for an unresolved link', () => {
    expect(target('{cursor}[[missing]]')).toBeNull();
  });

  it('returns null for an external link', () => {
    expect(target('{cursor}https://example.com')).toBeNull();
  });
});
