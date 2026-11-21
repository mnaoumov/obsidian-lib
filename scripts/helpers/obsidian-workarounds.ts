/**
 * @file
 *
 * Ties every Obsidian workaround in `src/` to the canary test that proves it is still needed.
 *
 * A workaround is marked in its module's comments as ``Obsidian workaround `<id>`, seen in Obsidian `<version>` ``.
 * Its canary is an integration test titled `workaround canary <id>: <the bug, still present>`, which reproduces the
 * bug WITHOUT the workaround and asserts the bug is still there. When an Obsidian release fixes the bug, the canary
 * goes red and names the id, so the workaround can be retired instead of living forever. `npm run test:canaries` runs
 * only the canaries. See `AGENTS.md`.
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
 * The text every canary test title starts with, and the `-t` filter `test:canaries` passes to Vitest.
 */
export const WORKAROUND_CANARY_TEST_NAME_PREFIX = 'workaround canary';

const ID_PATTERN = '[a-z0-9]+(?:-[a-z0-9]+)*';
const MARKER_REG_EXP = new RegExp(`Obsidian workaround \`(${ID_PATTERN})\`, seen in Obsidian \`(\\d+\\.\\d+\\.\\d+)\``, 'g');
const CANARY_REG_EXP = new RegExp(`\\bit\\(\\s*'${WORKAROUND_CANARY_TEST_NAME_PREFIX} (${ID_PATTERN}): `, 'g');

/**
 * One source file, as read for the check.
 */
export interface SourceFile {
  /**
   * The file's text.
   */
  readonly content: string;

  /**
   * The file's path relative to the package root, with `/` separators.
   */
  readonly path: string;
}

/**
 * Where an id was found.
 */
export interface WorkaroundLocation {
  /**
   * The workaround id.
   */
  readonly id: string;

  /**
   * The file it was found in.
   */
  readonly path: string;
}

/**
 * A workaround marker.
 */
export interface WorkaroundMarker extends WorkaroundLocation {
  /**
   * The Obsidian version the bug was seen on.
   */
  readonly seenInVersion: string;
}

/**
 * Finds the canary tests in the Obsidian integration test files.
 *
 * @param files - The files to scan.
 * @returns The canaries, in file order.
 */
export function findWorkaroundCanaries(files: readonly SourceFile[]): WorkaroundLocation[] {
  return files
    .filter((file) => file.path.endsWith('.obsidian.integration.test.ts'))
    .flatMap((file) => Array.from(file.content.matchAll(CANARY_REG_EXP), ([, id = '']) => ({ id, path: file.path })));
}

/**
 * Finds the workaround markers in the modules of `src/`, skipping test files and the `.d.ts` declarations the build
 * leaves beside them, which repeat each module's comments.
 *
 * @param files - The files to scan.
 * @returns The markers, in file order.
 */
export function findWorkaroundMarkers(files: readonly SourceFile[]): WorkaroundMarker[] {
  return files
    .filter((file) => !file.path.endsWith('.test.ts') && !file.path.endsWith('.d.ts'))
    .flatMap((file) => Array.from(file.content.matchAll(MARKER_REG_EXP), ([, id = '', seenInVersion = '']) => ({ id, path: file.path, seenInVersion })));
}

/**
 * Finds where markers and canaries fail to pair up: each id must be marked once and have at least one canary, and each
 * canary must name a marked id.
 *
 * @param files - The files to check.
 * @returns One line per problem; empty when the registry is consistent.
 */
export function findWorkaroundRegistryProblems(files: readonly SourceFile[]): string[] {
  const markers = findWorkaroundMarkers(files);
  const canaries = findWorkaroundCanaries(files);
  const problems: string[] = [];
  const markerPathsById = new Map<string, string[]>();
  for (const marker of markers) {
    markerPathsById.set(marker.id, [...markerPathsById.get(marker.id) ?? [], marker.path]);
  }
  const canaryIds = new Set(canaries.map((canary) => canary.id));

  for (const [id, paths] of markerPathsById) {
    if (paths.length > 1) {
      problems.push(`Workaround \`${id}\` is marked more than once: ${paths.join(', ')}. Mark it once, where the workaround lives.`);
    }
    if (!canaryIds.has(id)) {
      problems.push(`Workaround \`${id}\` (${paths.join(', ')}) has no canary: add an integration test titled '${WORKAROUND_CANARY_TEST_NAME_PREFIX} ${id}: ...'.`);
    }
  }
  for (const canary of canaries) {
    if (!markerPathsById.has(canary.id)) {
      problems.push(`Canary \`${canary.id}\` (${canary.path}) names no marked workaround: mark the workaround, or remove the canary with it.`);
    }
  }
  return problems;
}

/**
 * Reads every `.ts` file under `src/`.
 *
 * @param rootDirectory - The package root.
 * @returns The files, with root-relative `/` paths.
 */
export async function readSourceFiles(rootDirectory: string): Promise<SourceFile[]> {
  const sourceDirectory = join(rootDirectory, 'src');
  const entries = await readdir(sourceDirectory, { recursive: true, withFileTypes: true });
  const files: SourceFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) {
      continue;
    }
    const fullPath = join(entry.parentPath, entry.name);
    files.push({ content: await readFile(fullPath, 'utf-8'), path: relative(rootDirectory, fullPath).replaceAll('\\', '/') });
  }
  return files;
}
