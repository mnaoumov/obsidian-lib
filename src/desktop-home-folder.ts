/**
 * @file
 *
 * The user's home folder, on desktop.
 *
 * Desktop-only (`node:os`), but inert to import on mobile: nothing here reads the module until the function runs.
 * The import is static on purpose; see `desktop-git-runner.ts` for why a dynamic `import('node:os')` would not
 * load in Obsidian's renderer.
 */

import { homedir } from 'node:os';

/**
 * Gets the user's home folder. Call it only on desktop, behind `Platform.isDesktopApp`.
 *
 * @returns The absolute path of the home folder.
 */
export function getHomeFolderPath(): string {
  return homedir();
}
