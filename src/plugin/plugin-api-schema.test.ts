import type { StandardSchemaV1 } from '@standard-schema/spec';
import type {
  Plugin,
  PluginManifest
} from 'obsidian';

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
  PluginApiMethodContract
} from './plugin-api.ts';

import {
  createArgumentsSchema,
  createTypeGuardSchema
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

function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

const COUNTER_CONTRACT: PluginApiContract<CounterApi> = {
  count: {
    input: createArgumentsSchema<[text: string, isCaseSensitive?: boolean]>([
      { expected: 'a string', typeGuard: isString },
      { expected: 'a boolean or undefined', typeGuard: isOptionalBoolean }
    ]),
    output: createTypeGuardSchema({ expected: 'a number', typeGuard: isNumber })
  }
};

function validate<T>(schema: StandardSchemaV1<unknown, T>, value: unknown): StandardSchemaV1.Result<T> {
  const result = schema['~standard'].validate(value);
  if (result instanceof Promise) {
    throw new TypeError('Expected a synchronous schema.');
  }
  return result;
}

describe('createTypeGuardSchema', () => {
  const schema = createTypeGuardSchema({ expected: 'a number', typeGuard: isNumber });

  it('should accept a value the guard accepts', () => {
    expect(validate(schema, 1)).toEqual({ value: 1 });
  });

  it('should report a value the guard refuses', () => {
    expect(validate(schema, '1')).toEqual({ issues: [{ message: 'Expected a number.' }] });
  });

  it('should be a Standard Schema of this library', () => {
    expect(schema['~standard'].version).toBe(1);
    expect(schema['~standard'].vendor).toBe('obsidian-dev-utils');
  });
});

describe('createArgumentsSchema', () => {
  const schema = COUNTER_CONTRACT.count.input;

  it('should accept a full argument list', () => {
    expect(validate(schema, ['a', true])).toEqual({ value: ['a', true] });
  });

  it('should accept an argument list missing an optional argument', () => {
    expect(validate(schema, ['a'])).toEqual({ value: ['a'] });
  });

  it('should refuse a value that is not an argument list', () => {
    expect(validate(schema, 'a')).toEqual({ issues: [{ message: 'Expected an argument list.' }] });
  });

  it('should refuse too many arguments', () => {
    expect(validate(schema, ['a', true, 1])).toEqual({ issues: [{ message: 'Expected at most 2 argument(s), got 3.' }] });
  });

  it('should report each failing argument by its index', () => {
    expect(validate(schema, [1, 'x'])).toEqual({
      issues: [
        { message: 'Expected a string.', path: [0] },
        { message: 'Expected a boolean or undefined.', path: [1] }
      ]
    });
  });
});

describe('PluginApiContract', () => {
  it('should type each entry against its method', () => {
    expectTypeOf(COUNTER_CONTRACT.count.input).toEqualTypeOf<StandardSchemaV1<unknown, Parameters<CounterApi['count']>>>();
    expectTypeOf(COUNTER_CONTRACT.count.output).toEqualTypeOf<StandardSchemaV1<unknown, number>>();
  });

  it('should refuse a contract that does not match the API', () => {
    // @ts-expect-error -- `count` is missing.
    const missingMethod: PluginApiContract<CounterApi> = {};

    const extraMethod: PluginApiContract<CounterApi> = {
      count: COUNTER_CONTRACT.count,
      // @ts-expect-error -- `reset` is not a method of the API.
      reset: COUNTER_CONTRACT.count
    };

    const emptyEntry: PluginApiContract<CounterApi> = {
      // @ts-expect-error -- A typed entry needs both schemas.
      count: {}
    };

    const wrongOutput: PluginApiContract<CounterApi> = {
      count: {
        input: COUNTER_CONTRACT.count.input,
        // @ts-expect-error -- The output schema must produce the awaited return value, a number.
        output: createTypeGuardSchema({ expected: 'a string', typeGuard: isString })
      }
    };

    expect([missingMethod, extraMethod, emptyEntry, wrongOutput]).toHaveLength(4);
  });

  it('should keep the untyped form loose', () => {
    expectTypeOf<PluginApiContract>().toEqualTypeOf<Readonly<Record<string, PluginApiMethodContract>>>();
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
