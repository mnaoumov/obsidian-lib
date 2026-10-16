/**
 * @file
 *
 * Dependency-free {@link https://standardschema.dev | Standard Schema} builders for the payload halves of a
 * `PluginApiContract`.
 *
 * A contract's schemas cross the registry inside the provider's record and run inside whichever library copy
 * made the call, so they are plain objects over plain functions — which a type guard already is. These builders
 * turn the guards a module already has into the two shapes a method contract needs: one value (an output) and
 * one argument list (an input). zod / valibot / arktype schemas plug into the same slots unchanged; this library
 * just does not make every consumer bundle one to describe two arguments.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';

import { OBSIDIAN_LIBRARY_NAME } from '../library.ts';

/**
 * One type guard per parameter of a method, in order.
 *
 * @typeParam TParameters - The method's parameters.
 */
export type ArgumentTypeGuards<TParameters extends readonly unknown[]> = {
  readonly [TIndex in keyof TParameters]: CreateTypeGuardSchemaParams<TParameters[TIndex]>;
};

/**
 * One value a schema accepts, described by a type guard.
 *
 * @typeParam T - The type the guard narrows to.
 */
export interface CreateTypeGuardSchemaParams<T> {
  /**
   * What the value should have been, phrased to follow "Expected", e.g. `'a string'`.
   */
  readonly expected: string;

  /**
   * Decides whether the value is acceptable.
   *
   * @param value - The value to check.
   * @returns Whether the value is a `T`.
   */
  readonly typeGuard: (value: unknown) => value is T;
}

/**
 * Builds the input schema of a method contract: a schema over the method's ARGUMENT LIST, one type guard per
 * parameter. An argument that fails its guard is reported with its index as the issue path, and an argument
 * list longer than the parameter list is refused. A missing argument reaches its guard as `undefined`, so an
 * optional parameter's guard accepts `undefined`.
 *
 * @typeParam TParameters - The method's parameters, inferred from the guards.
 * @param parameters - One guard per parameter, in order.
 * @returns The schema.
 */
export function createArgumentsSchema<TParameters extends readonly unknown[]>(
  parameters: ArgumentTypeGuards<TParameters>
): StandardSchemaV1<unknown, TParameters> {
  const parameterList = castTo<readonly CreateTypeGuardSchemaParams<unknown>[]>(parameters);
  return createSchema((value: unknown): StandardSchemaV1.Result<TParameters> => {
    if (!Array.isArray(value)) {
      return { issues: [{ message: 'Expected an argument list.' }] };
    }

    if (value.length > parameterList.length) {
      return { issues: [{ message: `Expected at most ${String(parameterList.length)} argument(s), got ${String(value.length)}.` }] };
    }

    const issues = parameterList.flatMap((parameter, index): StandardSchemaV1.Issue[] => parameter.typeGuard(value[index]) ? [] : [{ message: `Expected ${parameter.expected}.`, path: [index] }]);
    return issues.length === 0 ? { value: castTo<TParameters>(value) } : { issues };
  });
}

/**
 * Builds a schema over one value from a type guard — the output schema of a method contract, typically.
 *
 * @typeParam T - The type the guard narrows to.
 * @param params - The guard and what it expects.
 * @returns The schema.
 */
export function createTypeGuardSchema<T>(params: CreateTypeGuardSchemaParams<T>): StandardSchemaV1<unknown, T> {
  return createSchema((value: unknown): StandardSchemaV1.Result<T> => params.typeGuard(value) ? { value } : { issues: [{ message: `Expected ${params.expected}.` }] });
}

function createSchema<T>(validate: (value: unknown) => StandardSchemaV1.Result<T>): StandardSchemaV1<unknown, T> {
  return {
    '~standard': {
      validate,
      vendor: OBSIDIAN_LIBRARY_NAME,
      version: 1
    }
  };
}
