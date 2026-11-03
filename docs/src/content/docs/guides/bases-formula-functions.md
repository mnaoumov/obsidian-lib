---
title: Bases Formula Functions
description: Register plugin-owned global and instance functions for Bases formulas.
---

`registerFormulaFunction` supplies the function object that Bases expects, including context handling and call serialization. Obsidian unregisters it when the owning plugin unloads. These registration methods are unofficial APIs, verified against Obsidian 1.15.0. Use `@obsidian-typings/obsidian-public-latest` 6.58.0 or later for their declarations.

## Register a global function

```ts
import {
  createFormulaFunctionParameter,
  registerFormulaFunction
} from '@mnaoumov/obsidian-lib/formula-function';
import { NumberValue, Plugin } from 'obsidian';

export class AlphaPlugin extends Plugin {
  public override onload(): void {
    registerFormulaFunction({
      plugin: this,
      name: 'alphaDouble',
      docString: 'Double a number.',
      params: [createFormulaFunctionParameter({ name: 'value', type: [NumberValue] })],
      evaluate(_ctx, value) {
        if (!(value instanceof NumberValue)) {
          throw new Error('Expected a number');
        }
        return new NumberValue(Number(value.toString()) * 2);
      }
    });
  }
}
```

The formula `alphaDouble(21)` returns `42`. Evaluators are synchronous and return an Obsidian `Value`, such as `NumberValue`, `StringValue` or `NullValue`. Obsidian validates the argument count and value classes before calling them. Optional arguments arrive as `null`, so handle that explicitly. A parameter's `type` lists the accepted value classes; the first names the expected type in validation errors.

## Register an instance function

Set `instanceType` to the receiver's value class, and include that receiver as the first parameter. Bases passes it as the first value after the context. For example, this registers `"bravo".alphaShout()`:

```ts
import {
  createFormulaFunctionParameter,
  registerFormulaFunction
} from '@mnaoumov/obsidian-lib/formula-function';
import { Plugin, StringValue } from 'obsidian';

export class AlphaPlugin extends Plugin {
  public override onload(): void {
    registerFormulaFunction({
      plugin: this,
      name: 'alphaShout',
      instanceType: StringValue,
      params: [createFormulaFunctionParameter({ name: 'value', type: [StringValue] })],
      evaluate(_ctx, value) {
        return new StringValue(`${value?.toString()}!`);
      }
    });
  }
}
```

## Parameters, context and lifetime

`createFormulaFunctionParameter` builds a required parameter by default. Set `isOptional: true` to allow omission, `isVariadic: true` on the final parameter to accept the remaining arguments, and `customWidget` to override the filter-editor widget (`file`, `folder`, `property`, `tags` or `text`). These options map to Obsidian's `optional`, `variadic` and `customWidget` metadata. Only the final parameter may be variadic.

`evaluate(ctx, ...values)` receives the formula context for the current call. The returned function's `ctx` is restored in a `finally` block, including after exceptions and recursive calls. Calling `apply` directly uses the current context, normally `null`, and bypasses Bases argument validation. Calling `applyWithContext` supplies a context explicitly.

Use `createFormulaFunction` when you want to register the returned object through `Plugin.registerGlobalFunc` or `Plugin.registerInstanceFunc` yourself. The `instanceType` option controls instance-call serialization; use it consistently with the registration method. `serialize` takes already serialized expressions and emits `name(args)` or `receiver.name(args)`.

Names are case-insensitive and shared with other plugins and built-in functions. Registering an existing name replaces it; unloading removes the name rather than restoring the previous definition. Use a distinctive plugin prefix and avoid collisions. Unloading also makes saved formulas that use the function unavailable until the plugin loads again.
