/**
 * @file
 *
 * Tests for the deprecated plugin-API contract names, and for a contract built with
 * `@mnaoumov/typescript-lib/api-contract` driving the registry's validation. The builders' own behavior is
 * tested in `@mnaoumov/typescript-lib`.
 */

/* eslint-disable @typescript-eslint/no-deprecated, import-x/no-deprecated -- This file pins the deprecated contract names to their typescript-lib replacements. */

import type {
  ApiContract,
  ApiMethodContract,
  ApiMethodName,
  ApiMethods,
  TypedApiContract
} from '@mnaoumov/typescript-lib/api-contract';
import type {
  Plugin,
  PluginManifest
} from 'obsidian';

import {
  BOOLEAN_GUARD,
  createArgumentsSchema,
  createTypeGuardSchema,
  defineApiContract,
  NUMBER_GUARD,
  optionalGuard,
  STRING_GUARD
} from '@mnaoumov/typescript-lib/api-contract';
import { getDebugController } from '@mnaoumov/typescript-lib/debug';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it
} from 'vitest';

import type {
  PluginApiContract,
  PluginApiMethodContract,
  PluginApiMethodName,
  PluginApiMethods,
  TypedPluginApiContract
} from './plugin-api.ts';

import {
  createArgumentsSchema as deprecatedCreateArgumentsSchema,
  createTypeGuardSchema as deprecatedCreateTypeGuardSchema
} from './plugin-api-schema.ts';
import {
  findPluginApi,
  PluginApiValidationError,
  publishPluginApi
} from './plugin-api.ts';

const PLUGIN_API_DEBUG_NAMESPACE = 'obsidian-dev-utils:PluginApi';
const PROVIDER_ID = 'schema-provider';

interface CounterApi {
  count: (text: string, isCaseSensitive?: boolean) => Promise<number>;
  readonly name: string;
}

const COUNTER_CONTRACT = defineApiContract<CounterApi>({
  count: {
    input: createArgumentsSchema([STRING_GUARD, optionalGuard(BOOLEAN_GUARD)]),
    output: createTypeGuardSchema(NUMBER_GUARD)
  }
});

describe('the deprecated contract names', () => {
  it('should re-export the typescript-lib schema builders', () => {
    expect(deprecatedCreateArgumentsSchema).toBe(createArgumentsSchema);
    expect(deprecatedCreateTypeGuardSchema).toBe(createTypeGuardSchema);
  });

  it('should alias the typescript-lib contract types', () => {
    expectTypeOf<PluginApiContract>().toEqualTypeOf<ApiContract>();
    expectTypeOf<PluginApiContract<CounterApi>>().toEqualTypeOf<ApiContract<CounterApi>>();
    expectTypeOf<TypedPluginApiContract<CounterApi>>().toEqualTypeOf<TypedApiContract<CounterApi>>();
    expectTypeOf<PluginApiMethodContract<[string], number>>().toEqualTypeOf<ApiMethodContract<[string], number>>();
    expectTypeOf<PluginApiMethodName<CounterApi>>().toEqualTypeOf<ApiMethodName<CounterApi>>();
    expectTypeOf<PluginApiMethods<CounterApi>>().toEqualTypeOf<ApiMethods<CounterApi>>();
  });
});

describe('a typed contract at runtime', () => {
  let savedDebugNamespaces: string[];

  beforeEach(() => {
    savedDebugNamespaces = getDebugController().get();
  });

  afterEach(() => {
    getDebugController().set(savedDebugNamespaces);
  });

  function publishCounter(count: CounterApi['count']): () => void {
    const unloadCallbacks: (() => void)[] = [];
    publishPluginApi<CounterApi>({
      api: { count, name: 'counter' },
      apiVersion: '1.0.0',
      contract: COUNTER_CONTRACT,
      plugin: strictProxy<Plugin>({
        manifest: strictProxy<PluginManifest>({ id: PROVIDER_ID }),
        register: (callback: () => void): void => {
          unloadCallbacks.push(callback);
        }
      })
    });
    return (): void => {
      for (const callback of unloadCallbacks) {
        callback();
      }
    };
  }

  function findCounter(): CounterApi | null {
    return findPluginApi<CounterApi>({ apiVersionRange: '^1.0.0', contract: COUNTER_CONTRACT, pluginId: PROVIDER_ID });
  }

  it('should report a provider whose output breaks the contract while the debugger is on', async () => {
    getDebugController().set(PLUGIN_API_DEBUG_NAMESPACE);
    const unload = publishCounter(() => Promise.resolve(castTo<number>('three')));
    try {
      await expect(findCounter()?.count('abc')).rejects.toThrow(PluginApiValidationError);
      await expect(findCounter()?.count('abc')).rejects.toThrow(
        'The output of "schema-provider" API method "count" failed validation: Expected a number.'
      );
    } finally {
      unload();
    }
  });

  it('should report a call whose input breaks the contract while the debugger is on', () => {
    getDebugController().set(PLUGIN_API_DEBUG_NAMESPACE);
    const unload = publishCounter((text) => Promise.resolve(text.length));
    try {
      expect(() => findCounter()?.count(castTo<string>(1))).toThrow(
        'The input of "schema-provider" API method "count" failed validation: 0: Expected a string.'
      );
    } finally {
      unload();
    }
  });

  it('should not validate while the debugger is off', async () => {
    getDebugController().set([]);
    const unload = publishCounter(() => Promise.resolve(castTo<number>('three')));
    try {
      await expect(findCounter()?.count('abc')).resolves.toBe('three');
    } finally {
      unload();
    }
  });
});

/* eslint-enable @typescript-eslint/no-deprecated, import-x/no-deprecated -- The end of the file. */
