/**
 * @file
 *
 * The NPM publish entry point `.github/workflows/publish-npm.yml` runs: publishes the package under the `beta`
 * dist-tag for a pre-release and `latest` otherwise.
 */

import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { readPackageJson } from '@mnaoumov/typescript-dev-toolkit/npm';
import { publish } from '@mnaoumov/typescript-dev-toolkit/npm-publish';
import { isPreRelease } from '@mnaoumov/typescript-dev-toolkit/version';

await wrapCliTask(async () => {
  const { version } = await readPackageJson();
  if (!version) {
    throw new Error('package.json declares no version.');
  }
  await publish(isPreRelease(version));
});
