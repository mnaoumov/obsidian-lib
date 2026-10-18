import { fileURLToPath } from 'node:url';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  extractDocsSnippets,
  findDocsSnippetProblems,
  formatDocsSnippetProblems
} from './docs-snippets.ts';

const ROOT_DIR = fileURLToPath(new URL('../..', import.meta.url));

// Compiling every guide snippet builds one program over `src/`, which takes tens of seconds.
const FULL_CHECK_TIMEOUT_IN_MILLISECONDS = 180_000;

describe('extractDocsSnippets', () => {
  it('should extract only the checked languages, with the line the code starts on', () => {
    const snippets = extractDocsSnippets(['# Title', '', '```ts', 'const a = 1;', '```', '', '```bash', 'npm test', '```', '', '```js', 'b();', '```'].join('\n'));
    expect(snippets.map((snippet) => [snippet.language, snippet.code, snippet.codeStartLine, snippet.isJavaScript])).toEqual([
      ['ts', 'const a = 1;', 4, false],
      ['js', 'b();', 12, true]
    ]);
  });

  it('should strip a blockquote prefix', () => {
    const [snippet] = extractDocsSnippets(['> ```ts', '> class A {}', '>', '> ```'].join('\n'));
    expect(snippet?.code).toBe('class A {}\n');
  });

  it('should read the skip and context markers right above the fence', () => {
    const snippets = extractDocsSnippets([
      '<!-- snippet-check: skip pseudo-code -->',
      '',
      '```ts',
      'alpha();',
      '```',
      '<!-- snippet-check: context declare const x: number; -->',
      '<!-- snippet-check: context declare const y: number; -->',
      '```ts',
      'x + y;',
      '```',
      '<!-- snippet-check: skip -->',
      'Some prose in between.',
      '```ts',
      'z();',
      '```'
    ].join('\n'));
    expect(snippets.map((snippet) => [snippet.skipReason, snippet.context])).toEqual([
      ['pseudo-code', ''],
      [null, 'declare const x: number;\ndeclare const y: number;'],
      [null, '']
    ]);
  });

  it('should report a skip marker without a reason as an empty reason', () => {
    const [snippet] = extractDocsSnippets(['<!-- snippet-check: skip -->', '```ts', 'a();', '```'].join('\n'));
    expect(snippet?.skipReason).toBe('');
  });
});

describe('findDocsSnippetProblems', () => {
  it('should type-check every snippet of the guides', { timeout: FULL_CHECK_TIMEOUT_IN_MILLISECONDS }, async () => {
    const problems = await findDocsSnippetProblems({ rootDirectory: ROOT_DIR });
    expect(formatDocsSnippetProblems(problems)).toBe('');
  });
});
