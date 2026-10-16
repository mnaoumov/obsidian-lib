import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { lint } from '@mnaoumov/typescript-dev-toolkit/linters/markdownlint';
import process from 'node:process';

// The site's pages link base-absolutely (`/obsidian-lib/...`), which resolves only against the built site, and
// `npm run docs:build` checks every link of that site itself.
const LINK_CHECK_EXCLUDE_GLOBS = ['docs/**'];

const [, , ...paths] = process.argv;

await wrapCliTask(async () => {
  await lint({ linkCheckExcludeGlobs: LINK_CHECK_EXCLUDE_GLOBS, paths });
});
