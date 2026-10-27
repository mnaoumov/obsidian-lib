import type { StandardSchemaV1 } from '@standard-schema/spec';

import {
  describe,
  expect,
  it
} from 'vitest';

import { getSettingsMigrationApiContract } from './settings-migration-api.ts';

interface TestMigratableSettings {
  readonly isEnabled?: boolean;
}

function checkIsAccepted(schema: StandardSchemaV1, value: unknown): boolean {
  const result = schema['~standard'].validate(value);
  if (result instanceof Promise) {
    throw new TypeError('Expected a synchronous schema.');
  }
  return result.issues === undefined;
}

describe('getSettingsMigrationApiContract', () => {
  const { input, output } = getSettingsMigrationApiContract<TestMigratableSettings>().migrateSettings;

  it('should accept a proposal', () => {
    expect(checkIsAccepted(input, [{ proposedSettings: { isEnabled: true }, sourcePluginId: 'source' }])).toBe(true);
  });

  it('should refuse a proposal that breaks the signature', () => {
    expect(checkIsAccepted(input, [null])).toBe(false);
    expect(checkIsAccepted(input, [{ proposedSettings: null, sourcePluginId: 'source' }])).toBe(false);
    expect(checkIsAccepted(input, [{ proposedSettings: {}, sourcePluginId: 1 }])).toBe(false);
  });

  it('should check the outcome', () => {
    expect(checkIsAccepted(output, { isApplied: false })).toBe(true);
    expect(checkIsAccepted(output, { isApplied: 'no' })).toBe(false);
    expect(checkIsAccepted(output, undefined)).toBe(false);
  });
});
