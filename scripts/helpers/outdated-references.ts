/**
 * @file
 *
 * Finds references to the retired `obsidian-dev-utils` package that point a reader at something that no longer
 * exists: one of its module paths, a link into its repository, or the legacy console recipe for the shared abort
 * controller.
 *
 * The bare name `obsidian-dev-utils` is NOT flagged, because this library keeps it on purpose: it is the debug
 * namespace, the CSS class, the stylesheet id and the lifecycle event prefix, all wire names shared with older
 * copies (see `src/library.ts`). What is flagged is the name used as an ADDRESS.
 *
 * Scanned: `README.md`, the guides under `docs/src/content/docs` (not the generated API reference, which is
 * rendered from the TSDoc this also scans), and every non-test `.ts` file under `src/` and `scripts/`.
 * `CHANGELOG.md` is history and is not scanned. A line that names an old address on purpose, such as a migration
 * note, carries `outdated-reference-ok` on that line.
 */

import {
  readdir,
  readFile
} from 'node:fs/promises';
import {
  join,
  relative
} from 'node:path';

/**
 * The marker that allows an outdated reference on its line.
 */
export const OUTDATED_REFERENCE_ALLOW_MARKER = 'outdated-reference-ok';

interface OutdatedReferencePattern {
  readonly hint: string;
  readonly regExp: RegExp;
}

const OUTDATED_REFERENCE_PATTERNS: readonly OutdatedReferencePattern[] = [
  {
    hint: 'a module path or repository link of the retired `obsidian-dev-utils` package; name the `@mnaoumov/*` package that has it now',
    regExp: /obsidian-dev-utils\//u
  },
  {
    hint: 'an import of the retired `obsidian-dev-utils` package; import the `@mnaoumov/*` package that has it now',
    regExp: /from\s+['"]obsidian-dev-utils['"]/u
  },
  {
    hint: 'the legacy `__obsidianDevUtils` console recipe; use `getSharedAbortController()` or the `Symbol.for(\'@mnaoumov/typescript-lib/state\')` slot',
    regExp: /__obsidianDevUtils\.sharedAbortController/u
  }
];

/**
 * An outdated reference found in a file.
 */
export interface OutdatedReference {
  /**
   * The file's path, relative to the package root.
   */
  readonly filePath: string;

  /**
   * What to write instead.
   */
  readonly hint: string;

  /**
   * The 1-based line.
   */
  readonly line: number;

  /**
   * The line's text, trimmed.
   */
  readonly text: string;
}

/**
 * Finds the outdated references in the package.
 *
 * @param rootDirectory - The package root.
 * @returns The outdated references.
 */
export async function findOutdatedReferences(rootDirectory: string): Promise<OutdatedReference[]> {
  const files = [
    join(rootDirectory, 'README.md'),
    ...await listFiles(join(rootDirectory, 'docs', 'src', 'content', 'docs'), (name) => /\.mdx?$/u.test(name), ['api']),
    ...await listFiles(join(rootDirectory, 'src'), isScannedSource, []),
    ...await listFiles(join(rootDirectory, 'scripts'), isScannedSource, [])
  ];
  const references: OutdatedReference[] = [];
  for (const file of files) {
    references.push(...findOutdatedReferencesInText(relative(rootDirectory, file).replaceAll('\\', '/'), await readFile(file, 'utf-8')));
  }
  return references;
}

/**
 * Finds the outdated references in one file's text.
 *
 * @param filePath - The file's path, used in the result.
 * @param text - The file's text.
 * @returns The outdated references, in line order.
 */
export function findOutdatedReferencesInText(filePath: string, text: string): OutdatedReference[] {
  const references: OutdatedReference[] = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (line.includes(OUTDATED_REFERENCE_ALLOW_MARKER)) {
      continue;
    }
    for (const pattern of OUTDATED_REFERENCE_PATTERNS) {
      if (pattern.regExp.test(line)) {
        references.push({ filePath, hint: pattern.hint, line: index + 1, text: line.trim() });
        break;
      }
    }
  }
  return references;
}

/**
 * Formats references one per line, as `path:line - text (hint)`.
 *
 * @param references - The references.
 * @returns The formatted text.
 */
export function formatOutdatedReferences(references: readonly OutdatedReference[]): string {
  return references.map((reference) => `${reference.filePath}:${String(reference.line)} - ${reference.text} (${reference.hint})`).join('\n');
}

function isScannedSource(name: string): boolean {
  return name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.test.ts') && name !== '__merged.ts';
}

async function listFiles(directory: string, isIncluded: (name: string) => boolean, excludedDirectories: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.includes(entry.name)) {
        files.push(...await listFiles(entryPath, isIncluded, excludedDirectories));
      }
    } else if (isIncluded(entry.name)) {
      files.push(entryPath);
    }
  }
  return files.sort();
}
