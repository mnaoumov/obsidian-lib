/**
 * @file
 *
 * Desktop git runner with Node modules loaded only when a command runs.
 */

import type { GitRunner } from './git-rename-history.ts';

/**
 * Large enough for the rename history of any vault: `--diff-filter=R` keeps only the renames. 256 MiB.
 */
const GIT_OUTPUT_LIMIT_IN_BYTES = 268_435_456;

/**
 * Creates a {@link GitRunner} for a folder.
 *
 * Call the runner only on desktop, behind `Platform.isDesktopApp`. Importing this module and creating a
 * runner are safe on mobile: Node modules load only when the runner executes a command.
 *
 * @param cwd - The folder to run `git` in.
 * @returns The runner.
 */
export function createDesktopGitRunner(cwd: string): GitRunner {
  return async (arguments_) => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('git', [...arguments_], { cwd, encoding: 'utf-8', maxBuffer: GIT_OUTPUT_LIMIT_IN_BYTES, windowsHide: true });
    return stdout;
  };
}
