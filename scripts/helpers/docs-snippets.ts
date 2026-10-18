/**
 * @file
 *
 * Extracts the code snippets of the documentation guides and type-checks them against this package's sources.
 *
 * A guide's snippet is code a reader copies, so a renamed member or a stale import path in it is a bug that ships
 * to the site with every check green. Every fenced `ts`, `typescript`, `js` or `javascript` block in
 * `docs/src/content/docs` is compiled as its own module, with the project's `tsconfig.json`, so an import of
 * `@mnaoumov/obsidian-lib/...` resolves to `src/` and a wrong name fails here. A `ts` / `typescript` block is
 * compiled as TypeScript; a `js` / `javascript` block, which in these guides is a devtools-console recipe, is
 * compiled as JavaScript with `checkJs`, so a wrong member of a typed object still fails while an untyped lookup
 * does not. The generated API reference (`docs/src/content/docs/api`) is skipped: it is rendered from the TSDoc.
 *
 * Three things shape what a snippet is compiled with, each written in the guide as an HTML comment, invisible on the
 * site, on the lines right above the fence:
 *
 * - The names every guide may use without declaring them are {@link SNIPPET_PRELUDE}.
 * - `<!-- snippet-check: context <TypeScript> -->` prepends declarations to that one snippet, for the names its
 *   prose has already introduced (`declare const linkEl: HTMLAnchorElement;`). Several such lines add up.
 * - `<!-- snippet-check: skip <reason> -->` exempts a snippet that is deliberately not compilable, such as
 *   pseudo-code. The reason is required, so a skip is a decision somebody wrote down, never a silent hole.
 */

import type {
  CompilerOptions,
  SourceFile
} from 'typescript';

import {
  readdir,
  readFile
} from 'node:fs/promises';
import {
  join,
  relative,
  resolve
} from 'node:path';
import {
  createCompilerHost,
  createProgram,
  createSourceFile,
  flattenDiagnosticMessageText,
  getParsedCommandLineOfConfigFile,
  ScriptKind,
  sys
} from 'typescript';

/**
 * The languages of the fenced blocks that are type-checked, and whether each is JavaScript.
 */
const CHECKED_LANGUAGES: ReadonlyMap<string, boolean> = new Map([
  ['javascript', true],
  ['js', true],
  ['ts', false],
  ['typescript', false]
]);

/**
 * The offset from a fence line's 0-based index to the 1-based line of the code after it.
 */
const LINE_AFTER_FENCE_OFFSET = 2;

const MARKER_REG_EXP = /^<!--\s*snippet-check:\s*(?<kind>[a-z]+)\b(?<text>.*?)-->$/su;

/**
 * Diagnostics a snippet is not held to: an illustration declares names it never reads.
 */
const DIAGNOSTIC_DECLARED_BUT_VALUE_NEVER_READ = 6133;
const DIAGNOSTIC_ALL_IMPORTS_UNUSED = 6192;
const DIAGNOSTIC_DECLARED_BUT_NEVER_USED = 6196;
const DIAGNOSTIC_ALL_DESTRUCTURED_ELEMENTS_UNUSED = 6198;
const IGNORED_DIAGNOSTIC_CODES = new Set([
  DIAGNOSTIC_ALL_DESTRUCTURED_ELEMENTS_UNUSED,
  DIAGNOSTIC_ALL_IMPORTS_UNUSED,
  DIAGNOSTIC_DECLARED_BUT_NEVER_USED,
  DIAGNOSTIC_DECLARED_BUT_VALUE_NEVER_READ
]);

/**
 * The implicit-`any` diagnostics, which a JavaScript snippet is not held to: a console recipe has no annotations to
 * give, and an untyped lookup such as a `Symbol.for` slot on `globalThis` is what plain JavaScript does.
 */
const DIAGNOSTIC_VARIABLE_IMPLICITLY_ANY = 7005;
const DIAGNOSTIC_PARAMETER_IMPLICITLY_ANY = 7006;
const DIAGNOSTIC_MEMBER_IMPLICITLY_ANY = 7008;
const DIAGNOSTIC_BINDING_ELEMENT_IMPLICITLY_ANY = 7031;
const DIAGNOSTIC_VARIABLE_IMPLICITLY_ANY_IN_SOME_LOCATIONS = 7034;
const DIAGNOSTIC_ARROW_FUNCTION_CAPTURES_GLOBAL_THIS = 7041;
const DIAGNOSTIC_ELEMENT_IMPLICITLY_ANY = 7053;
const JAVASCRIPT_IGNORED_DIAGNOSTIC_CODES = new Set([
  DIAGNOSTIC_ARROW_FUNCTION_CAPTURES_GLOBAL_THIS,
  DIAGNOSTIC_BINDING_ELEMENT_IMPLICITLY_ANY,
  DIAGNOSTIC_ELEMENT_IMPLICITLY_ANY,
  DIAGNOSTIC_MEMBER_IMPLICITLY_ANY,
  DIAGNOSTIC_PARAMETER_IMPLICITLY_ANY,
  DIAGNOSTIC_VARIABLE_IMPLICITLY_ANY,
  DIAGNOSTIC_VARIABLE_IMPLICITLY_ANY_IN_SOME_LOCATIONS
]);

/**
 * The ambient context every snippet is compiled with: the names a guide may use without declaring them. `app` is
 * not here because `obsidian-typings` already declares it globally.
 */
export const SNIPPET_PRELUDE = `import type { DebugController } from '@mnaoumov/typescript-lib/debug-controller';
import type { TFile } from 'obsidian';

declare global {
  /** The element a setting component or a view renders into. */
  const containerEl: HTMLElement;
  /** A note the surrounding prose is talking about. */
  const file: TFile;

  interface Window {
    /** The devtools-console debug controller every plugin built on this library installs. */
    DEBUG: DebugController;
  }
}
`;

/**
 * One fenced code block of a guide.
 */
export interface DocsSnippet {
  /**
   * The code, with any blockquote or indentation prefix of the fence stripped.
   */
  readonly code: string;

  /**
   * The 1-based line of the guide on which the code starts (the line after the opening fence).
   */
  readonly codeStartLine: number;

  /**
   * The declarations of the `snippet-check: context` markers above the fence, joined by newlines.
   */
  readonly context: string;

  /**
   * Whether the snippet is JavaScript rather than TypeScript.
   */
  readonly isJavaScript: boolean;

  /**
   * The language of the fence.
   */
  readonly language: string;

  /**
   * The reason given by a `snippet-check: skip` marker, or `null` when the snippet is checked.
   */
  readonly skipReason: null | string;
}

/**
 * A problem found in a guide's snippet.
 */
export interface DocsSnippetProblem {
  /**
   * The guide's path, relative to the package root.
   */
  readonly filePath: string;

  /**
   * The 1-based line of the guide.
   */
  readonly line: number;

  /**
   * What is wrong.
   */
  readonly message: string;
}

/**
 * Parameters for {@link findDocsSnippetProblems}.
 */
export interface FindDocsSnippetProblemsParams {
  /**
   * The guides directory, relative to {@link FindDocsSnippetProblemsParams.rootDirectory}.
   *
   * @default `'docs/src/content/docs'`
   */
  readonly docsDirectory?: string;

  /**
   * The package root, holding `tsconfig.json`.
   */
  readonly rootDirectory: string;
}

interface OpenFence {
  readonly context: string[];
  readonly fence: string;
  readonly language: string;
  readonly prefix: string;
  readonly skipReason: null | string;
  readonly startLine: number;
}

interface VirtualSnippetFile {
  readonly code: string;
  readonly codeStartLine: number;
  readonly contextLineCount: number;
  readonly filePath: string;
}

/**
 * Extracts the fenced code blocks of the checked languages from a markdown document.
 *
 * A fence inside a blockquote or a list item is recognized too: its prefix (`> `, indentation) is stripped from
 * every line of its code.
 *
 * @param markdown - The markdown document.
 * @returns The snippets, in document order.
 */
export function extractDocsSnippets(markdown: string): DocsSnippet[] {
  const lines = markdown.split(/\r?\n/u);
  const snippets: DocsSnippet[] = [];
  let openFence: null | OpenFence = null;
  let codeLines: string[] = [];
  let pendingSkipReason: null | string = null;
  let pendingContext: string[] = [];

  for (const [index, line] of lines.entries()) {
    if (openFence) {
      const content = stripPrefix(line, openFence.prefix);
      if (content.trimEnd() === openFence.fence) {
        const isJavaScript = CHECKED_LANGUAGES.get(openFence.language);
        if (isJavaScript !== undefined) {
          snippets.push({
            code: codeLines.join('\n'),
            codeStartLine: openFence.startLine,
            context: openFence.context.join('\n'),
            isJavaScript,
            language: openFence.language,
            skipReason: openFence.skipReason
          });
        }
        openFence = null;
        codeLines = [];
      } else {
        codeLines.push(content);
      }
      continue;
    }

    const fenceMatch = /^(?<prefix>(?:\s*>)*\s*)(?<fence>`{3,}|~{3,})(?<language>[\w-]*)/u.exec(line);
    if (fenceMatch?.groups) {
      openFence = {
        context: pendingContext,
        fence: fenceMatch.groups['fence'] ?? '',
        language: (fenceMatch.groups['language'] ?? '').toLowerCase(),
        prefix: fenceMatch.groups['prefix'] ?? '',
        skipReason: pendingSkipReason,
        startLine: index + LINE_AFTER_FENCE_OFFSET
      };
      pendingSkipReason = null;
      pendingContext = [];
      continue;
    }

    const text = line.replace(/^(?:\s*>)*\s*/u, '').trim();
    const markerMatch = MARKER_REG_EXP.exec(text);
    const kind = markerMatch?.groups?.['kind'];
    const markerText = (markerMatch?.groups?.['text'] ?? '').trim();
    if (kind === 'skip') {
      pendingSkipReason = markerText.replace(/^[-—:]\s*/u, '');
    } else if (kind === 'context') {
      pendingContext.push(markerText);
    } else if (text !== '') {
      pendingSkipReason = null;
      pendingContext = [];
    }
  }

  return snippets;
}

/**
 * Type-checks every snippet of the guides.
 *
 * @param params - The {@link FindDocsSnippetProblemsParams}.
 * @returns The problems found, empty when every snippet compiles.
 */
export async function findDocsSnippetProblems(params: FindDocsSnippetProblemsParams): Promise<DocsSnippetProblem[]> {
  const rootDirectory = resolve(params.rootDirectory);
  const docsDirectory = join(rootDirectory, params.docsDirectory ?? 'docs/src/content/docs');
  const problems: DocsSnippetProblem[] = [];
  const virtualFiles = new Map<string, VirtualSnippetFile>();
  const rootNames: string[] = [];
  const snippetsDirectory = join(rootDirectory, 'docs', '__snippets__');

  function addVirtualFile(path: string, file: VirtualSnippetFile): void {
    virtualFiles.set(normalizePath(path), file);
    rootNames.push(path);
  }

  addVirtualFile(join(snippetsDirectory, 'prelude.ts'), { code: SNIPPET_PRELUDE, codeStartLine: 1, contextLineCount: 0, filePath: '<prelude>' });

  for (const guidePath of await listGuides(docsDirectory)) {
    const filePath = toPosix(relative(rootDirectory, guidePath));
    const markdown = await readFile(guidePath, 'utf-8');
    for (const snippet of extractDocsSnippets(markdown)) {
      if (snippet.skipReason === '') {
        problems.push({
          filePath,
          line: snippet.codeStartLine - 1,
          message: 'A `snippet-check: skip` marker must give its reason.'
        });
        continue;
      }
      if (snippet.skipReason !== null) {
        continue;
      }
      const extension = snippet.isJavaScript ? 'js' : 'ts';
      const baseName = `${toPosix(relative(docsDirectory, guidePath)).replaceAll('/', '__')}.L${String(snippet.codeStartLine)}.${extension}`;
      const context = snippet.context === '' ? '' : `${snippet.context}\n`;
      addVirtualFile(join(snippetsDirectory, baseName), {
        code: `${context}${snippet.code}\nexport {};\n`,
        codeStartLine: snippet.codeStartLine,
        contextLineCount: context === '' ? 0 : context.split('\n').length - 1,
        filePath
      });
    }
  }

  problems.push(...compileSnippets(rootDirectory, virtualFiles, rootNames));
  return problems;
}

/**
 * Formats problems one per line, as `path:line - message`.
 *
 * @param problems - The problems.
 * @returns The formatted text.
 */
export function formatDocsSnippetProblems(problems: readonly DocsSnippetProblem[]): string {
  return problems.map((problem) => `${problem.filePath}:${String(problem.line)} - ${problem.message}`).join('\n');
}

function compileSnippets(
  rootDirectory: string,
  virtualFiles: ReadonlyMap<string, VirtualSnippetFile>,
  rootNames: readonly string[]
): DocsSnippetProblem[] {
  const configPath = join(rootDirectory, 'tsconfig.json');
  const parsed = getParsedCommandLineOfConfigFile(configPath, {}, {
    ...sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic) {
      throw new Error(flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    }
  });
  if (!parsed) {
    throw new Error(`Cannot read ${configPath}`);
  }

  const compilerOptions: CompilerOptions = {
    ...parsed.options,
    allowJs: true,
    checkJs: true,
    composite: false,
    incremental: false,
    noEmit: true,
    noUnusedLocals: false,
    noUnusedParameters: false
  };
  delete compilerOptions.tsBuildInfoFile;

  const host = createCompilerHost(compilerOptions, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  host.fileExists = (fileName): boolean => virtualFiles.has(normalizePath(fileName)) || originalFileExists(fileName);
  host.readFile = (fileName): string | undefined => virtualFiles.get(normalizePath(fileName))?.code ?? originalReadFile(fileName);
  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile): SourceFile | undefined => {
    const virtualFile = virtualFiles.get(normalizePath(fileName));
    if (virtualFile) {
      const scriptKind = fileName.endsWith('.js') ? ScriptKind.JS : ScriptKind.TS;
      return createSourceFile(fileName, virtualFile.code, languageVersionOrOptions, true, scriptKind);
    }
    return originalGetSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
  };

  const program = createProgram({ host, options: compilerOptions, rootNames });
  const problems: DocsSnippetProblem[] = [];
  for (const rootName of rootNames) {
    const sourceFile = program.getSourceFile(rootName);
    const virtualFile = virtualFiles.get(normalizePath(rootName));
    if (!sourceFile || !virtualFile) {
      continue;
    }
    const isJavaScript = rootName.endsWith('.js');
    const diagnostics = [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)];
    for (const diagnostic of diagnostics) {
      if (IGNORED_DIAGNOSTIC_CODES.has(diagnostic.code) || (isJavaScript && JAVASCRIPT_IGNORED_DIAGNOSTIC_CODES.has(diagnostic.code))) {
        continue;
      }
      const fileLine = diagnostic.start === undefined ? 0 : sourceFile.getLineAndCharacterOfPosition(diagnostic.start).line;
      const snippetLine = Math.max(0, fileLine - virtualFile.contextLineCount);
      problems.push({
        filePath: virtualFile.filePath,
        line: virtualFile.codeStartLine + snippetLine,
        message: `TS${String(diagnostic.code)}: ${flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`
      });
    }
  }
  return problems;
}

async function listGuides(directory: string): Promise<string[]> {
  const guides: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'api') {
        guides.push(...await listGuides(entryPath));
      }
    } else if (/\.mdx?$/u.test(entry.name)) {
      guides.push(entryPath);
    }
  }
  return guides.sort();
}

function normalizePath(path: string): string {
  return toPosix(resolve(path)).toLowerCase();
}

function stripPrefix(line: string, prefix: string): string {
  return line.startsWith(prefix) ? line.slice(prefix.length) : line.replace(/^(?:\s*>)*\s?/u, '');
}

function toPosix(path: string): string {
  return path.replaceAll('\\', '/');
}
