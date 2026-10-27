/**
 * @file
 *
 * The release entry point: `npm run version '--' <type> [flags]`.
 *
 * The generic release bumps the version, settles `CHANGELOG.md`, commits, tags, pushes and creates the GitHub
 * release. The release carries no assets: the package is distributed through NPM, which
 * `.github/workflows/publish-npm.yml` publishes to from a fresh build when the release is published.
 */

import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import {
  parseVersionArguments,
  updateVersion
} from '@mnaoumov/typescript-dev-toolkit/version';
import process from 'node:process';

await wrapCliTask(async () => {
  const [, , ...versionArguments] = process.argv;
  const { options, versionUpdateType } = parseVersionArguments(versionArguments);
  await updateVersion(versionUpdateType, {
    ...options,
    getReleaseAssetPaths: () => Promise.resolve([])
  });
});
