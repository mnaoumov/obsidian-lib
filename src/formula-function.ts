/**
 * @file
 *
 * Construction and plugin-scoped registration of Bases formula functions.
 */

import type {
  FormulaFunction,
  FormulaFunctionParam
} from '@obsidian-typings/obsidian-public-latest';
import type {
  Constructor,
  FormulaContext,
  Plugin,
  Value
} from 'obsidian';

/**
 * Parameters for {@link createFormulaFunctionParameter}.
 */
export interface CreateFormulaFunctionParameterParams {
  /**
   * Filter-editor widget, such as `file`, `folder`, `property`, `tags` or `text`.
   */
  readonly customWidget?: string;
  /**
   * Whether omitted arguments are accepted and passed as `null`.
   *
   * @default `false`
   */
  readonly isOptional?: boolean;
  /**
   * Whether this final parameter accepts all remaining arguments.
   *
   * @default `false`
   */
  readonly isVariadic?: boolean;
  /**
   * Name displayed in formula completion.
   */
  readonly name: string;
  /**
   * Accepted value classes. The first names the expected type in errors.
   */
  readonly type: Constructor<Value>[];
}

/**
 * Parameters for {@link createFormulaFunction}.
 */
export interface CreateFormulaFunctionParams {
  /**
   * Description shown in formula completion.
   */
  readonly docString?: (() => string) | string;
  /**
   * Synchronous evaluator. Direct `apply` calls receive a `null` context.
   */
  readonly evaluate: (context: FormulaContext | null, ...arguments_: (null | Value)[]) => Value;
  /**
   * The receiver class for an instance function; omit for a global function.
   *
   * @default `undefined`
   */
  readonly instanceType?: Constructor<Value>;
  /**
   * Function name, matched case-insensitively by Obsidian.
   */
  readonly name: string;
  /**
   * Parameters, including the receiver first for an instance function.
   */
  readonly params: FormulaFunctionParam[];
}

/**
 * Parameters for {@link registerFormulaFunction}.
 */
export interface RegisterFormulaFunctionParams extends CreateFormulaFunctionParams {
  /**
   * Plugin whose unload removes the registration.
   */
  readonly plugin: Plugin;
}

/**
 * Creates a Bases function without accessing Obsidian's unexported base class.
 * Context is restored even when evaluation throws or recursively evaluates the same function.
 * Argument validation is performed by Obsidian's evaluator, not by direct `apply` calls.
 *
 * @param params - Function definition.
 * @returns The function, ready for either of Obsidian's registration methods.
 */
export function createFormulaFunction(params: CreateFormulaFunctionParams): FormulaFunction {
  const { docString, evaluate, instanceType, name } = params;
  return {
    // eslint-disable-next-line unicorn/name-replacements -- Obsidian's FormulaFunction contract names this member ctx.
    ctx: null,
    ...(docString !== undefined && { docString }),
    apply(...arguments_): Value {
      return evaluate(this.ctx, ...arguments_);
    },
    applyWithContext(context, ...arguments_): Value {
      const previousContext = this.ctx;
      // eslint-disable-next-line unicorn/name-replacements -- Obsidian's FormulaFunction contract names this member ctx.
      this.ctx = context;
      try {
        return this.apply(...arguments_);
      } finally {
        // eslint-disable-next-line unicorn/name-replacements -- Obsidian's FormulaFunction contract names this member ctx.
        this.ctx = previousContext;
      }
    },
    name,
    params: params.params,
    serialize(...arguments_): string {
      if (instanceType) {
        const [receiver, ...rest] = arguments_;
        if (receiver === undefined) {
          throw new Error('An instance formula function requires a receiver');
        }
        return `${receiver}.${name}(${rest.join(', ')})`;
      }
      return `${name}(${arguments_.join(', ')})`;
    }
  };
}

/**
 * Builds the parameter metadata consumed by Bases completion, validation and filter widgets.
 * Only the last parameter of a function may be variadic.
 *
 * @param params - Parameter definition.
 * @returns Obsidian's parameter metadata.
 */
export function createFormulaFunctionParameter(params: CreateFormulaFunctionParameterParams): FormulaFunctionParam {
  const { customWidget, isOptional = false, isVariadic = false, name, type } = params;
  return {
    ...(customWidget !== undefined && { customWidget }),
    name,
    optional: isOptional,
    type,
    variadic: isVariadic
  };
}

/**
 * Creates and registers a Bases function for a plugin's lifetime.
 * Names share Obsidian's registry: use a distinctive name to avoid replacing another function.
 *
 * @param params - Function definition and owning plugin.
 * @returns The registered function.
 */
export function registerFormulaFunction(params: RegisterFormulaFunctionParams): FormulaFunction {
  const function_ = createFormulaFunction(params);
  if (params.instanceType) {
    params.plugin.registerInstanceFunc(params.instanceType, function_);
  } else {
    params.plugin.registerGlobalFunc(function_);
  }
  return function_;
}
