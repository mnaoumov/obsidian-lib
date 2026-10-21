/**
 * @file
 *
 * Resets the `__obsidianLib` shared-state bag before each unit test.
 *
 * `@mnaoumov/obsidian-dev-toolkit/vitest-setup` resets the shared state through the module this package published
 * before `6.0.0`, which `selfSourcePlugin` cannot find in `src/` any more, so its reset reaches the installed older
 * copy and leaves this package's bag untouched.
 */

// TODO: Drop this file once `@mnaoumov/obsidian-dev-toolkit/vitest-setup` resets the bag through `@mnaoumov/obsidian-lib/obsidian-lib-state`.

import { beforeEach } from 'vitest';

import { resetObsidianLibState } from '../src/obsidian-lib-state.ts';

beforeEach(() => {
  resetObsidianLibState();
});
