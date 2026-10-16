import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { validateDependencies } from '@mnaoumov/typescript-dev-toolkit/validate-dependencies';

await wrapCliTask(() => validateDependencies());
