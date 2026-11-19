---
title: Scripted dialogs
description: Show `alert`, `confirm`, `prompt` and selection modals through a `DialogContext`, and answer them from a script in tests.
---

Code that asks the user something through a [modal](/obsidian-lib/guides/modals/) is hard to unit test: the test has to find the modal, click its button and wait for it to close. A `DialogContext` removes that step. Production code shows its dialogs through the context, and a test hands the context a driver that answers them from a script.

## Showing dialogs through a context

A `DialogContext` has one method per modal, `alert`, `confirm`, `prompt`, `selectItem` and `selectOption`. Each takes the same parameters as the free function, without `app`, plus an optional `interactionId`. With no driver, each method opens the real modal.

```ts
import { DialogContext } from '@mnaoumov/obsidian-lib/modals/dialog-context';

async function confirmRestore(dialogContext: DialogContext): Promise<boolean> {
  return await dialogContext.confirm({
    interactionId: 'restore-files',
    message: 'Restore the selected files?',
    title: 'Restore'
  });
}

const dialogContext = new DialogContext({ app });
await confirmRestore(dialogContext);
```

The `interactionId` names why a dialog is shown, independent of its translated title, so a script can tell two dialogs of the same kind apart. Create one context per plugin instance, and pass it to the code that needs it. Never keep a driver in a module global or a class static, because its queued answers would leak between tests, vaults and plugins. Nothing of the context is kept in the library's shared state.

## Answering dialogs in a test

`createDialogTestHarness` gives a context with no `App`, answered by a `ScriptedDialogDriver`. The driver takes its steps in order. Each step names the kind of dialog it expects and, optionally, its interaction id; a request of another kind or id fails the test at once.

<!-- snippet-check: context declare function confirmRestore(dialogContext: import('@mnaoumov/obsidian-lib/modals/dialog-context').DialogContext): Promise<boolean>; -->

```ts
import { createDialogTestHarness } from '@mnaoumov/obsidian-lib/modals/scripted-dialog-driver';
import { expect } from 'vitest';

const harness = createDialogTestHarness([
  { interactionId: 'restore-files', kind: 'confirm', value: true }
]);

expect(await confirmRestore(harness.dialogContext)).toBe(true);
expect(harness.driver.transcript[0]?.kind).toBe('confirm');
harness.assertDone();
```

`assertDone()` fails when a step was never used, so a dialog the code stopped showing is caught too. `transcript` records every request in order, with the parameters it was shown with.

| `kind` | `value` | Checked against the real modal |
| --- | --- | --- |
| `alert` | none | No value. |
| `confirm` | `boolean` | A boolean. |
| `prompt` | `string` or `null` | A string the prompt's `valueValidator` accepts, or `null`. |
| `selectItem` | an item or `null` | The identical instance from `items`, or `null`. |
| `selectOption` | an option value or `null` | One of the options' `value`s, or `null`. |

A value the real modal could never return throws an `InvalidDialogResponseError`, so a scripted test cannot pass with an answer no user could give.

### Deriving an answer from the request

Use `valueProvider` instead of `value` to look at the request first, for example to assert on the dialog's text:

```ts
import { createDialogTestHarness } from '@mnaoumov/obsidian-lib/modals/scripted-dialog-driver';
import { expect } from 'vitest';

const harness = createDialogTestHarness([
  {
    kind: 'prompt',
    valueProvider(request): string {
      expect(request.params.title).toBe('Device name');
      return 'laptop';
    }
  }
]);
```

The request's type follows the step's `kind`, so `request.params` is the prompt's parameters there.

### Letting the real modal open

A step with `isPassthrough: true` checks and records its request, then lets the real modal open. That needs a context built with an `app` and the driver:

```ts
import { DialogContext } from '@mnaoumov/obsidian-lib/modals/dialog-context';
import { ScriptedDialogDriver } from '@mnaoumov/obsidian-lib/modals/scripted-dialog-driver';

const driver = new ScriptedDialogDriver([{ interactionId: 'restore-files', isPassthrough: true, kind: 'confirm' }]);
const dialogContext = new DialogContext({ app, driver });
```

A driver is strict by default: a dialog after its last step throws. With `isStrict: false` such a dialog opens the real modal instead. Prefer the strict default for deterministic tests.

## What a script does not cover

A scripted answer never renders the modal, so it says nothing about keyboard handling, focus or layout. Cover those with an integration test against a real Obsidian. And never enable a driver from a setting, a URI parameter or anything else a user can reach in production.
