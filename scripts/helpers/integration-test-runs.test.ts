import {
  describe,
  expect,
  it
} from 'vitest';

import {
  buildIntegrationTestVitestArguments,
  getBulkCores,
  getProjectNames,
  selectIntegrationTestProjects
} from './integration-test-runs.ts';

const AVAILABLE_PROJECT_NAMES = [
  'unit-tests',
  'unit-tests:scripts',
  'integration-tests',
  'obsidian-integration-tests',
  'obsidian-integration-tests:demo-vault-helper',
  'obsidian-integration-tests:plugin-api',
  'obsidian-integration-tests-extra'
];

describe('selectIntegrationTestProjects', () => {
  it('selects each requested project and its siblings, in config order', () => {
    expect(selectIntegrationTestProjects({
      availableProjectNames: AVAILABLE_PROJECT_NAMES,
      requestedProjects: ['obsidian-integration-tests', 'integration-tests']
    })).toEqual([
      'integration-tests',
      'obsidian-integration-tests',
      'obsidian-integration-tests:demo-vault-helper',
      'obsidian-integration-tests:plugin-api'
    ]);
  });

  it('throws when nothing is requested', () => {
    expect(() => selectIntegrationTestProjects({ availableProjectNames: AVAILABLE_PROJECT_NAMES, requestedProjects: [] }))
      .toThrow('Name the vitest projects holding the integration tests.');
  });

  it('throws when a requested name matches no project', () => {
    expect(() => selectIntegrationTestProjects({ availableProjectNames: AVAILABLE_PROJECT_NAMES, requestedProjects: ['missing'] }))
      .toThrow('No vitest project matches \'missing\'.');
  });
});

describe('buildIntegrationTestVitestArguments', () => {
  it('runs one project and tolerates an empty one', () => {
    expect(buildIntegrationTestVitestArguments({ env: {}, projectName: 'integration-tests' }))
      .toEqual(['run', '--project=integration-tests', '--passWithNoTests']);
  });

  it('caps the workers at the bulk budget', () => {
    expect(buildIntegrationTestVitestArguments({ env: { BULK_CORES: '2' }, projectName: 'p' }))
      .toEqual(['run', '--project=p', '--passWithNoTests', '--maxWorkers=2']);
  });

  it('leaves the workers to VITEST_MAX_WORKERS when that is set', () => {
    expect(buildIntegrationTestVitestArguments({ env: { BULK_CORES: '2', VITEST_MAX_WORKERS: '1' }, projectName: 'p' }))
      .toEqual(['run', '--project=p', '--passWithNoTests']);
  });
});

describe('getBulkCores', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['0', null],
    ['-1', null],
    ['1.5', null],
    ['abc', null],
    [' 3 ', 3],
    ['2', 2]
  ])('reads %j as %j', (value, expected) => {
    expect(getBulkCores({ BULK_CORES: value })).toBe(expected);
  });
});

describe('getProjectNames', () => {
  it('reads the names of inline projects and skips the rest', () => {
    expect(getProjectNames([
      { test: { name: 'a' } },
      'packages/*',
      null,
      {},
      { test: null },
      { test: {} },
      { test: { name: 1 } },
      { test: { name: 'b' } }
    ])).toEqual(['a', 'b']);
  });
});
