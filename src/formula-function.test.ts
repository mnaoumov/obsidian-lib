import type {
  FormulaContext,
  Plugin as PluginOriginal
} from 'obsidian';

import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  NumberValue,
  StringValue
} from 'obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  createFormulaFunction,
  createFormulaFunctionParameter,
  registerFormulaFunction
} from './formula-function.ts';

describe('formula functions', () => {
  it('should evaluate with the supplied context and clear it after a failure', () => {
    const context = strictProxy<FormulaContext>({});
    const evaluate = vi.fn(() => {
      throw new Error('alpha');
    });
    const function_ = createFormulaFunction({ evaluate, name: 'alpha', params: [] });
    expect(() => function_.applyWithContext(context)).toThrow('alpha');
    expect(evaluate).toHaveBeenCalledWith(context);
    expect(function_.ctx).toBeNull();
  });

  it('should serialize global and instance calls', () => {
    const params = { evaluate: (): NumberValue => new NumberValue(1), name: 'alpha', params: [] };
    expect(createFormulaFunction(params).serialize('1', '2')).toBe('alpha(1, 2)');
    expect(createFormulaFunction({ ...params, instanceType: StringValue }).serialize('"bravo"', '2')).toBe('"bravo".alpha(2)');
    expect(createFormulaFunction(params).serialize()).toBe('alpha()');
    expect(createFormulaFunction({ ...params, instanceType: StringValue }).serialize('"bravo"')).toBe('"bravo".alpha()');
    expect(() => createFormulaFunction({ ...params, instanceType: StringValue }).serialize()).toThrow('requires a receiver');
  });

  it('should build optional variadic parameters with a custom editor widget', () => {
    expect(createFormulaFunctionParameter({ customWidget: 'text', isOptional: true, isVariadic: true, name: 'alpha', type: [StringValue] }))
      .toEqual({ customWidget: 'text', name: 'alpha', optional: true, type: [StringValue], variadic: true });
  });

  it('should make parameters required and non-variadic by default', () => {
    expect(createFormulaFunctionParameter({ name: 'alpha', type: [StringValue, NumberValue] }))
      .toEqual({ name: 'alpha', optional: false, type: [StringValue, NumberValue], variadic: false });
  });

  it('should forward arguments and documentation and evaluate directly without a context', () => {
    const value = new NumberValue(1);
    const evaluate = vi.fn(() => value);
    const params = [createFormulaFunctionParameter({ name: 'alpha', type: [NumberValue] })];
    const function_ = createFormulaFunction({ docString, evaluate, name: 'alpha', params });
    expect(function_.docString).toBe(docString);
    expect(function_.name).toBe('alpha');
    expect(function_.params).toBe(params);
    expect(function_.apply(value, null)).toBe(value);
    expect(evaluate).toHaveBeenCalledWith(null, value, null);
    expect(function_.ctx).toBeNull();

    function docString(): string {
      return 'alpha description';
    }
  });

  it('should restore the outer context after recursive evaluation', () => {
    const outer = strictProxy<FormulaContext>({});
    const inner = strictProxy<FormulaContext>({});
    const value = new NumberValue(1);
    const contexts: (FormulaContext | null)[] = [];
    const function_ = createFormulaFunction({
      evaluate(context) {
        contexts.push(context);
        if (context === outer) {
          function_.applyWithContext(inner);
          contexts.push(function_.ctx);
        }
        return value;
      },
      name: 'alpha',
      params: []
    });
    expect(function_.applyWithContext(outer, value)).toBe(value);
    expect(contexts).toEqual([outer, inner, outer]);
    expect(function_.ctx).toBeNull();
  });

  it('should restore an outer context when a recursive call throws', () => {
    const outer = strictProxy<FormulaContext>({});
    const inner = strictProxy<FormulaContext>({});
    const value = new NumberValue(1);
    const function_ = createFormulaFunction({
      evaluate(context) {
        if (context === outer) {
          expect(() => function_.applyWithContext(inner)).toThrow('alpha');
          expect(function_.ctx).toBe(outer);
          return value;
        }
        throw new Error('alpha');
      },
      name: 'alpha',
      params: []
    });
    expect(function_.applyWithContext(outer)).toBe(value);
    expect(function_.ctx).toBeNull();
  });

  it('should delegate global and instance registration to the owning plugin', () => {
    const registerGlobalFunction = vi.fn();
    const registerInstanceFunction = vi.fn();
    const plugin = strictProxy<PluginOriginal>({
      // eslint-disable-next-line unicorn/name-replacements -- Obsidian's Plugin contract names this member registerGlobalFunc.
      registerGlobalFunc: registerGlobalFunction,
      // eslint-disable-next-line unicorn/name-replacements -- Obsidian's Plugin contract names this member registerInstanceFunc.
      registerInstanceFunc: registerInstanceFunction
    });
    const params = { evaluate: (): NumberValue => new NumberValue(1), name: 'alpha', params: [], plugin };
    const globalFunction = registerFormulaFunction(params);
    expect(registerGlobalFunction).toHaveBeenCalledExactlyOnceWith(globalFunction);
    expect(registerInstanceFunction).not.toHaveBeenCalled();
    const instanceFunction = registerFormulaFunction({ ...params, instanceType: StringValue });
    expect(registerInstanceFunction).toHaveBeenCalledExactlyOnceWith(StringValue, instanceFunction);
    expect(globalFunction.serialize()).toBe('alpha()');
    expect(instanceFunction.serialize('"bravo"')).toBe('"bravo".alpha()');
  });
});
