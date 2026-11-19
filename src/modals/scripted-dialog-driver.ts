/**
 * @file
 *
 * A FIFO {@link DialogDriver} that answers a {@link DialogContext}'s dialogs from a script, for tests.
 *
 * It imports nothing from Obsidian or from a test framework, so any test runner can use it, and a test needs no
 * Obsidian `App` when every dialog it reaches is scripted.
 */

import type { Promisable } from 'type-fest';

import type {
  DialogDriver,
  DialogDriverResponse,
  DialogKind,
  DialogRequest,
  DialogResultMap
} from './dialog-context.ts';

import {
  describeDialogRequest,
  DialogContext
} from './dialog-context.ts';

/**
 * Options for {@link createDialogTestHarness}.
 */
export type CreateDialogTestHarnessOptions = ScriptedDialogDriverConstructorOptions;

/**
 * A test fixture: a {@link DialogContext} answered by its own {@link ScriptedDialogDriver}.
 */
export interface DialogTestHarness {
  /**
   * Throws when a scripted step was never used.
   */
  readonly assertDone: () => void;

  /**
   * The context the code under test shows its dialogs through.
   */
  readonly dialogContext: DialogContext;

  /**
   * The driver holding the script and the transcript.
   */
  readonly driver: ScriptedDialogDriver;
}

/**
 * A step that acknowledges an `alert`, which has no result.
 */
export interface ScriptedDialogAlertStep {
  /**
   * Marks the step as an answer.
   */
  readonly isPassthrough?: false;

  /**
   * An alert has no result, so there is no value to give.
   */
  readonly value?: undefined;
}

/**
 * Options for constructing a {@link ScriptedDialogDriver}.
 */
export interface ScriptedDialogDriverConstructorOptions {
  /**
   * Whether a request after the script runs out throws, rather than opening the real modal.
   *
   * @default `true`
   */
  readonly isStrict?: boolean;
}

/**
 * A step that checks and records its dialog, then lets the real modal open.
 */
export interface ScriptedDialogPassthroughStep {
  /**
   * Marks the step as a pass-through.
   */
  readonly isPassthrough: true;
}

/**
 * One expected dialog, with its scripted answer or an explicit pass-through to the real modal.
 *
 * @typeParam Kind - The kind of the dialog it expects.
 */
export type ScriptedDialogStep<Kind extends DialogKind = DialogKind> = Kind extends DialogKind ?
    & (
      | (Kind extends 'alert' ? ScriptedDialogAlertStep : ScriptedDialogValueStep<Kind>)
      | ScriptedDialogPassthroughStep
      | ScriptedDialogValueProviderStep<Kind>
    )
    & ScriptedDialogStepBase<Kind>
  : never;

/**
 * The part of a {@link ScriptedDialogStep} every step has.
 *
 * @typeParam Kind - The kind of the dialog it expects.
 */
export interface ScriptedDialogStepBase<Kind extends DialogKind> {
  /**
   * The id the request must carry, when given.
   */
  readonly interactionId?: string;

  /**
   * The kind the next request must have.
   */
  readonly kind: Kind;
}

/**
 * A step that derives its answer from the observed request, for instance to assert on the dialog's parameters.
 *
 * @typeParam Kind - The kind of the dialog it answers.
 */
export interface ScriptedDialogValueProviderStep<Kind extends DialogKind> {
  /**
   * Marks the step as an answer.
   */
  readonly isPassthrough?: false;

  /**
   * Derives the answer from the request.
   *
   * @param request - The dialog about to be shown.
   * @returns The answer.
   */
  readonly valueProvider: (request: DialogRequest<Kind>) => Promisable<DialogResultMap[Kind]>;
}

/**
 * A step that answers its dialog with a fixed value.
 *
 * @typeParam Kind - The kind of the dialog it answers.
 */
export interface ScriptedDialogValueStep<Kind extends DialogKind> {
  /**
   * Marks the step as an answer.
   */
  readonly isPassthrough?: false;

  /**
   * The answer.
   */
  readonly value: DialogResultMap[Kind];
}

/**
 * A FIFO driver that answers each dialog with the next step of its script.
 *
 * It checks the request's kind, and its interaction id when the step names one, records every request in
 * {@link ScriptedDialogDriver.transcript}, and {@link ScriptedDialogDriver.assertDone} fails when a step was never
 * used.
 */
export class ScriptedDialogDriver implements DialogDriver {
  /**
   * The number of steps not used yet.
   *
   * @returns The number of steps not used yet.
   */
  public get remainingStepCount(): number {
    return this.steps.length;
  }

  /**
   * Every request this driver saw, passed-through ones included, in order.
   *
   * @returns The requests.
   */
  public get transcript(): readonly DialogRequest[] {
    return this._transcript;
  }

  private readonly _transcript: DialogRequest[] = [];
  private readonly isStrict: boolean;
  private readonly steps: ScriptedDialogStep[];

  /**
   * Creates a scripted driver.
   *
   * @param steps - The expected dialogs, in order. The driver keeps its own copy.
   * @param options - The options.
   */
  public constructor(steps: readonly ScriptedDialogStep[], options: ScriptedDialogDriverConstructorOptions = {}) {
    this.steps = [...steps];
    this.isStrict = options.isStrict ?? true;
  }

  /**
   * Throws when a scripted step was never used.
   */
  public assertDone(): void {
    if (this.steps.length === 0) {
      return;
    }
    const pending = this.steps.map((step) => step.interactionId === undefined ? step.kind : `${step.kind} (${step.interactionId})`).join(', ');
    throw new Error(`Unused scripted dialog steps: ${pending}`);
  }

  /**
   * Records a request, checks it against the next step, and answers it.
   *
   * @param request - The dialog about to be shown.
   * @returns The step's answer, or a pass-through.
   */
  public async handle(request: DialogRequest): Promise<DialogDriverResponse> {
    this._transcript.push(request);
    const step = this.steps.shift();
    if (step === undefined) {
      if (this.isStrict) {
        throw new Error(`Unexpected dialog: ${describeDialogRequest(request)}`);
      }
      return { isHandled: false };
    }
    if (step.kind !== request.kind) {
      throw new Error(`Expected a ${step.kind} dialog, got ${describeDialogRequest(request)}`);
    }
    if (step.interactionId !== undefined && step.interactionId !== request.interactionId) {
      throw new Error(`Expected the ${step.kind} dialog ${step.interactionId}, got ${describeDialogRequest(request)}`);
    }
    if (step.isPassthrough) {
      return { isHandled: false };
    }
    if ('valueProvider' in step) {
      const valueProvider = step.valueProvider as (request: DialogRequest) => Promisable<unknown>;
      return { isHandled: true, value: await valueProvider(request) };
    }
    return { isHandled: true, value: step.value };
  }
}

/**
 * Creates a {@link DialogContext} with no `App`, answered by a fresh {@link ScriptedDialogDriver}.
 *
 * A step that passes through throws there, since there is no real modal to open.
 *
 * @param steps - The expected dialogs, in order.
 * @param options - The driver options.
 * @returns The harness.
 */
export function createDialogTestHarness(steps: readonly ScriptedDialogStep[], options: CreateDialogTestHarnessOptions = {}): DialogTestHarness {
  const driver = new ScriptedDialogDriver(steps, options);
  return {
    assertDone(): void {
      driver.assertDone();
    },
    dialogContext: new DialogContext({ driver }),
    driver
  };
}
