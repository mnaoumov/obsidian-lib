/**
 * @file
 *
 * Plans `test:integration` as ONE vitest invocation per project instead of one invocation over all of them.
 *
 * Each Obsidian project owns a separate Obsidian instance, booted by its `globalSetup`. Vitest runs every selected
 * project's global setup before any test file, so a combined invocation provisions all four instances up front:
 * `fileParallelism: false` and distinct `sequence.groupOrder` values serialize the TESTS, never the setups. Under a
 * bulk run's processor budget of two, four live Obsidian instances beside the test workers was the failure measured
 * on 2026-10-27, while the same suites passed one project at a time. Separate invocations keep at most one instance
 * alive at once and lose no parallelism, because the group orders already ran those projects one after another.
 */

/**
 * The environment variable a bulk run sets to the number of logical processors this item may use.
 */
export const BULK_CORES_ENV_VARIABLE = 'BULK_CORES';

/**
 * The environment variable Vitest itself reads as its `maxWorkers` default.
 */
export const VITEST_MAX_WORKERS_ENV_VARIABLE = 'VITEST_MAX_WORKERS';

/**
 * Parameters for {@link buildIntegrationTestVitestArguments}.
 */
export interface BuildIntegrationTestVitestArgumentsParams {
  /**
   * The environment the run inherits.
   */
  readonly env: Readonly<Record<string, string | undefined>>;

  /**
   * The one vitest project this invocation runs.
   */
  readonly projectName: string;
}

/**
 * Parameters for {@link selectIntegrationTestProjects}.
 */
export interface SelectIntegrationTestProjectsParams {
  /**
   * Every project name the vitest config defines, in config order.
   */
  readonly availableProjectNames: readonly string[];

  /**
   * The names `test:integration` was given; each also selects its `<name>:*` siblings.
   */
  readonly requestedProjects: readonly string[];
}

/**
 * Builds the arguments of one vitest invocation for one integration project.
 *
 * `--passWithNoTests` keeps a project with no files (today `integration-tests`) from failing on its own, which the
 * combined invocation never did. When a bulk budget is set and Vitest's own `VITEST_MAX_WORKERS` is not, the budget
 * caps the workers too.
 *
 * @param params - The {@link BuildIntegrationTestVitestArgumentsParams}.
 * @returns The arguments after `vitest`.
 */
export function buildIntegrationTestVitestArguments(params: BuildIntegrationTestVitestArgumentsParams): string[] {
  const vitestArguments = ['run', `--project=${params.projectName}`, '--passWithNoTests'];
  const maxWorkers = getBulkCores(params.env);
  const vitestMaxWorkers = params.env[VITEST_MAX_WORKERS_ENV_VARIABLE] ?? '';
  if (maxWorkers !== null && vitestMaxWorkers === '') {
    vitestArguments.push(`--maxWorkers=${String(maxWorkers)}`);
  }
  return vitestArguments;
}

/**
 * Reads the bulk processor budget.
 *
 * @param env - The environment to read.
 * @returns The budget, or `null` when it is unset or not a positive integer.
 */
export function getBulkCores(env: Readonly<Record<string, string | undefined>>): null | number {
  const value = env[BULK_CORES_ENV_VARIABLE]?.trim() ?? '';
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const bulkCores = Number(value);
  return bulkCores > 0 ? bulkCores : null;
}

/**
 * Reads the project names out of a vitest config's `test.projects` list.
 *
 * @param projects - The `test.projects` entries.
 * @returns The names of the inline projects that carry one.
 */
export function getProjectNames(projects: readonly unknown[]): string[] {
  const names: string[] = [];
  for (const project of projects) {
    if (typeof project !== 'object' || project === null || !('test' in project)) {
      continue;
    }
    const test = project.test;
    if (typeof test !== 'object' || test === null || !('name' in test) || typeof test.name !== 'string') {
      continue;
    }
    names.push(test.name);
  }
  return names;
}

/**
 * Selects the projects one `test:integration` run covers, in config order.
 *
 * @param params - The {@link SelectIntegrationTestProjectsParams}.
 * @returns The selected project names.
 * @throws If nothing was requested, or a requested name matches no project.
 */
export function selectIntegrationTestProjects(params: SelectIntegrationTestProjectsParams): string[] {
  if (params.requestedProjects.length === 0) {
    throw new Error('Name the vitest projects holding the integration tests.');
  }

  for (const requestedProject of params.requestedProjects) {
    if (params.availableProjectNames.every((name) => !isRequestedProject(name, requestedProject))) {
      throw new Error(`No vitest project matches '${requestedProject}'.`);
    }
  }

  return params.availableProjectNames.filter((name) => params.requestedProjects.some((requestedProject) => isRequestedProject(name, requestedProject)));
}

function isRequestedProject(name: string, requestedProject: string): boolean {
  return name === requestedProject || name.startsWith(`${requestedProject}:`);
}
