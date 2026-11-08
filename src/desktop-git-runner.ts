/**
 * @file
 *
 * Desktop git runner.
 *
 * Desktop-only (`node:child_process`, `node:util`), but inert to import on mobile: nothing here reads either
 * module until the runner executes a command. The imports are static on purpose. A plugin ships one CommonJS
 * `main.js`, and esbuild turns a static import of an external module into a `require()`, which Obsidian's renderer
 * serves, while it keeps a dynamic `import('node:child_process')` as a native `import()`, which the renderer
 * cannot load. That failed every command, and `loadGitRenames` answered no renames at all.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { GitRunner } from './git-rename-history.ts';

/**
 * Large enough for the rename history of any vault: `--diff-filter=R` keeps only the renames. 256 MiB.
 */
const GIT_OUTPUT_LIMIT_IN_BYTES = 268_435_456;

/**
 * Creates a {@link GitRunner} for a folder.
 *
 * Call the runner only on desktop, behind `Platform.isDesktopApp`. Importing this module and creating a
 * runner are safe on mobile: Node modules are read only when the runner executes a command.
 *
 * @param cwd - The folder to run `git` in.
 * @returns The runner.
 */
export function createDesktopGitRunner(cwd: string): GitRunner {
  return async (arguments_) => {
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('git', [...arguments_], { cwd, encoding: 'utf-8', maxBuffer: GIT_OUTPUT_LIMIT_IN_BYTES, windowsHide: true });
    return stdout;
  };
}
