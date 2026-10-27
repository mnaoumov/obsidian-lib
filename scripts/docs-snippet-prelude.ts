/**
 * @file
 *
 * The ambient context every snippet of the documentation guides is compiled with, shared by the
 * `docs:check-snippets` script and the gate's `docs-checks.test.ts`.
 */

/**
 * The names a guide may use without declaring them. `app` is not here because `obsidian-typings` already declares
 * it globally.
 */
export const DOCS_SNIPPET_PRELUDE = `import type { DebugController } from '@mnaoumov/typescript-lib/debug-controller';
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
