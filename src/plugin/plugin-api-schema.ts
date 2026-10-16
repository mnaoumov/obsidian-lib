/**
 * @file
 *
 * The {@link https://standardschema.dev | Standard Schema} builders for the payload halves of a plugin API
 * contract, re-exported from `@mnaoumov/typescript-lib/api-contract`, where they now live.
 *
 * Nothing about them is Obsidian-specific: a contract's schemas are plain objects over plain functions, which a
 * type guard already is. Import them from `@mnaoumov/typescript-lib/api-contract` instead; these re-exports stay
 * only so that move lands in a minor, and go in the next major.
 */

export {
  /**
   * One type guard per parameter of a method, in order.
   *
   * @deprecated Import `ArgumentTypeGuards` from `@mnaoumov/typescript-lib/api-contract`.
   */
  type ArgumentTypeGuards,
  /**
   * Builds the input schema of a method contract.
   *
   * @deprecated Import `createArgumentsSchema` from `@mnaoumov/typescript-lib/api-contract`.
   */
  createArgumentsSchema,
  /**
   * Builds a schema over one value from a type guard.
   *
   * @deprecated Import `createTypeGuardSchema` from `@mnaoumov/typescript-lib/api-contract`.
   */
  createTypeGuardSchema,
  /**
   * One value a schema accepts, described by a type guard.
   *
   * @deprecated Import `CreateTypeGuardSchemaParams` (or `ExpectedTypeGuard`) from
   * `@mnaoumov/typescript-lib/api-contract`.
   */
  type CreateTypeGuardSchemaParams
} from '@mnaoumov/typescript-lib/api-contract';
