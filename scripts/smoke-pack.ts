/**
 * @file
 *
 * Packs this package, installs the tarball into an empty project and loads every exported module as ESM and as
 * CommonJS. Run it after `npm run build`; CI runs it after the gate.
 *
 * `obsidian` is supplied by Obsidian at runtime, and its npm package is types only, so a module that fails to load
 * only because `obsidian` is missing is accepted. Any other failure still fails.
 */

import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { smokePack } from '@mnaoumov/typescript-dev-toolkit/pack-smoke';

await wrapCliTask(() =>
  smokePack({
    hostProvidedPackages: ['obsidian']
  })
);
