/**
 * @file
 *
 * An instance-scoped context that opens the library's dialogs, and lets a test answer them instead.
 *
 * In production a {@link DialogContext} with no driver opens the real {@link alert}, {@link confirm}, {@link prompt},
 * {@link selectItem} and {@link selectOption} modals. A test hands the context a {@link DialogDriver}, usually a
 * `ScriptedDialogDriver` (`scripted-dialog-driver.ts`), which answers each request by its kind and interaction id.
 * Every answer a driver gives is checked against what the real modal could have returned, so a scripted test cannot
 * pass with a value no user could produce.
 *
 * The driver belongs to the context instance and nothing is kept in a module global, a class static or the shared
 * state bag, so scripted answers never leak between tests, vaults or plugins.
 */

import type { App } from 'obsidian';
import type {
  Except,
  Promisable
} from 'type-fest';

import type { AlertParams } from './alert.ts';
import type { ConfirmParams } from './confirm.ts';
import type { PromptParams } from './prompt.ts';
import type { SelectItemParams } from './select-item.ts';
import type { SelectOptionParams } from './select-option.ts';

import { alert } from './alert.ts';
import { confirm } from './confirm.ts';
import { prompt } from './prompt.ts';
import { selectItem } from './select-item.ts';
import { selectOption } from './select-option.ts';

/**
 * Parameters of {@link DialogContext.alert}.
 */
export interface DialogContextAlertParams extends DialogContextInteractionParams, Except<AlertParams, 'app'> {}

/**
 * Parameters of {@link DialogContext.confirm}.
 */
export interface DialogContextConfirmParams extends DialogContextInteractionParams, Except<ConfirmParams, 'app'> {}

/**
 * Parameters for constructing a {@link DialogContext}.
 */
export interface DialogContextConstructorParams {
  /**
   * The Obsidian app the real modals open in.
   *
   * Leave it out only in a test whose driver answers every request; a request passed through then throws.
   */
  readonly app?: App;

  /**
   * The driver consulted before each dialog opens. Leave it out in production, so every dialog is the real modal.
   */
  readonly driver?: DialogDriver;
}

/**
 * Parameters shared by every {@link DialogContext} method.
 */
export interface DialogContextInteractionParams {
  /**
   * A stable id naming why this dialog is shown, such as `restore-files`, independent of its translated title.
   *
   * A scripted driver matches its steps against it.
   */
  readonly interactionId?: string;
}

/**
 * Parameters of {@link DialogContext.prompt}.
 */
export interface DialogContextPromptParams extends DialogContextInteractionParams, Except<PromptParams, 'app'> {}

/**
 * Parameters of {@link DialogContext.selectItem}.
 *
 * @typeParam T - The type of the selectable items.
 */
export interface DialogContextSelectItemParams<T> extends DialogContextInteractionParams, Except<SelectItemParams<T>, 'app'> {}

/**
 * Parameters of {@link DialogContext.selectOption}.
 *
 * @typeParam T - The type of the value resolved when an option is chosen.
 */
export interface DialogContextSelectOptionParams<T> extends DialogContextInteractionParams, Except<SelectOptionParams<T>, 'app'> {}

/**
 * An instance-scoped driver that can observe dialog requests and answer them.
 *
 * `ScriptedDialogDriver` (`scripted-dialog-driver.ts`) is the one tests use.
 */
export interface DialogDriver {
  /**
   * Handles one dialog request, or passes it through to the real modal.
   *
   * @param request - The dialog about to be shown.
   * @returns The driver's answer.
   */
  readonly handle: (request: DialogRequest) => Promisable<DialogDriverResponse>;
}

/**
 * A driver's answer to a {@link DialogRequest}.
 */
export type DialogDriverResponse = HandledDialogDriverResponse | PassthroughDialogDriverResponse;

/**
 * The kind of a dialog a {@link DialogContext} shows, named after its method.
 */
export type DialogKind = keyof DialogParamsMap;

/**
 * The parameters a dialog of each kind is shown with, without the `app` and the interaction id.
 */
export interface DialogParamsMap {
  /**
   * The parameters of an {@link alert}.
   */
  readonly alert: Except<AlertParams, 'app'>;

  /**
   * The parameters of a {@link confirm}.
   */
  readonly confirm: Except<ConfirmParams, 'app'>;

  /**
   * The parameters of a {@link prompt}.
   */
  readonly prompt: Except<PromptParams, 'app'>;

  /**
   * The parameters of a {@link selectItem}.
   */
  readonly selectItem: Except<SelectItemParams<unknown>, 'app'>;

  /**
   * The parameters of a {@link selectOption}.
   */
  readonly selectOption: Except<SelectOptionParams<unknown>, 'app'>;
}

/**
 * A read-only description of one dialog a {@link DialogContext} is about to show.
 *
 * Narrowing on `kind` narrows `params`.
 *
 * @typeParam Kind - The kind of the dialog.
 */
export type DialogRequest<Kind extends DialogKind = DialogKind> = Kind extends DialogKind ? DialogRequestOfKind<Kind> : never;

/**
 * A {@link DialogRequest} of one kind.
 *
 * @typeParam Kind - The kind of the dialog.
 */
export interface DialogRequestOfKind<Kind extends DialogKind> {
  /**
   * The interaction id the caller gave, if any.
   */
  readonly interactionId?: string;

  /**
   * The kind of the dialog.
   */
  readonly kind: Kind;

  /**
   * The parameters the dialog is shown with.
   */
  readonly params: DialogParamsMap[Kind];
}

/**
 * The value a dialog of each kind resolves with.
 */
export interface DialogResultMap {
  /**
   * An {@link alert} resolves with nothing.
   */
  readonly alert: undefined;

  /**
   * A {@link confirm} resolves with whether the user confirmed.
   */
  readonly confirm: boolean;

  /**
   * A {@link prompt} resolves with the entered text, or `null` when dismissed.
   */
  readonly prompt: null | string;

  /**
   * A {@link selectItem} resolves with one of its items, or `null` when dismissed.
   */
  readonly selectItem: unknown;

  /**
   * A {@link selectOption} resolves with one of its option values, or `null` when dismissed.
   */
  readonly selectOption: unknown;
}

/**
 * A driver's answer that supplies the dialog's result, so no modal is opened.
 */
export interface HandledDialogDriverResponse {
  /**
   * Marks the request as handled.
   */
  readonly isHandled: true;

  /**
   * The result. It is checked against what the real dialog could have returned.
   */
  readonly value: unknown;
}

/**
 * A driver's answer that lets the real modal open.
 */
export interface PassthroughDialogDriverResponse {
  /**
   * Marks the request as not handled.
   */
  readonly isHandled: false;
}

/**
 * Opens the library's dialogs, or lets an instance-scoped {@link DialogDriver} answer them.
 *
 * @remarks
 * Create one context per plugin instance, or per test. Never keep a driver in a module global or a class static,
 * because queued answers would leak between tests, vaults and plugins.
 */
export class DialogContext {
  /**
   * The Obsidian app the real modals open in.
   */
  protected readonly app: App | undefined;

  /**
   * The driver consulted before each dialog opens.
   */
  protected readonly driver: DialogDriver | undefined;

  /**
   * Creates a dialog context.
   *
   * @param params - The parameters.
   */
  public constructor(params: DialogContextConstructorParams) {
    this.app = params.app;
    this.driver = params.driver;
  }

  /**
   * Shows an {@link alert}, or lets the driver acknowledge it.
   *
   * @param params - The parameters of the alert.
   * @returns A {@link Promise} that resolves when the alert is closed.
   */
  public async alert(params: DialogContextAlertParams): Promise<void> {
    const { interactionId, ...dialogParams } = params;
    const request = createRequest('alert', dialogParams, interactionId);
    const response = await this.handle(request);
    if (!response.isHandled) {
      await alert({ ...dialogParams, app: this.getApp(request) });
      return;
    }
    if (response.value !== undefined) {
      throw new InvalidDialogResponseError(request, 'expected no value');
    }
  }

  /**
   * Shows a {@link confirm}, or lets the driver answer it.
   *
   * @param params - The parameters of the confirmation.
   * @returns A {@link Promise} that resolves with whether the user confirmed.
   */
  public async confirm(params: DialogContextConfirmParams): Promise<boolean> {
    const { interactionId, ...dialogParams } = params;
    const request = createRequest('confirm', dialogParams, interactionId);
    const response = await this.handle(request);
    if (!response.isHandled) {
      return await confirm({ ...dialogParams, app: this.getApp(request) });
    }
    if (typeof response.value !== 'boolean') {
      throw new InvalidDialogResponseError(request, 'expected a boolean');
    }
    return response.value;
  }

  /**
   * Shows a {@link prompt}, or lets the driver answer it.
   *
   * A scripted text must pass the prompt's `valueValidator`, because the real prompt would not accept it otherwise.
   *
   * @param params - The parameters of the prompt.
   * @returns A {@link Promise} that resolves with the entered text, or `null` when dismissed.
   */
  public async prompt(params: DialogContextPromptParams): Promise<null | string> {
    const { interactionId, ...dialogParams } = params;
    const request = createRequest('prompt', dialogParams, interactionId);
    const response = await this.handle(request);
    if (!response.isHandled) {
      return await prompt({ ...dialogParams, app: this.getApp(request) });
    }
    if (response.value === null) {
      return null;
    }
    if (typeof response.value !== 'string') {
      throw new InvalidDialogResponseError(request, 'expected a string or null');
    }
    const errorMessage = await dialogParams.valueValidator?.(response.value) as null | string | undefined;
    if (errorMessage) {
      throw new InvalidDialogResponseError(request, `the prompt's validator refused it: ${errorMessage}`);
    }
    return response.value;
  }

  /**
   * Shows a {@link selectItem}, or lets the driver answer it.
   *
   * @typeParam T - The type of the selectable items.
   * @param params - The parameters of the selection.
   * @returns A {@link Promise} that resolves with the selected item, the identical instance from `items`, or `null`
   * when dismissed.
   */
  public async selectItem<T>(params: DialogContextSelectItemParams<T>): Promise<null | T> {
    const { interactionId, ...dialogParams } = params;
    const request = createRequest('selectItem', dialogParams as DialogParamsMap['selectItem'], interactionId);
    const response = await this.handle(request);
    if (!response.isHandled) {
      return await selectItem({ ...dialogParams, app: this.getApp(request) });
    }
    if (response.value === null) {
      return null;
    }
    if (!dialogParams.items.includes(response.value as T)) {
      throw new InvalidDialogResponseError(request, 'expected null or one of the supplied items');
    }
    return response.value as T;
  }

  /**
   * Shows a {@link selectOption}, or lets the driver answer it.
   *
   * @typeParam T - The type of the value resolved when an option is chosen.
   * @param params - The parameters of the selection.
   * @returns A {@link Promise} that resolves with the chosen option's value, or `null` when dismissed.
   */
  public async selectOption<T>(params: DialogContextSelectOptionParams<T>): Promise<null | T> {
    const { interactionId, ...dialogParams } = params;
    const request = createRequest('selectOption', dialogParams as DialogParamsMap['selectOption'], interactionId);
    const response = await this.handle(request);
    if (!response.isHandled) {
      return await selectOption({ ...dialogParams, app: this.getApp(request) });
    }
    if (response.value === null) {
      return null;
    }
    if (dialogParams.options.every((option) => !Object.is(option.value, response.value))) {
      throw new InvalidDialogResponseError(request, 'expected null or one of the option values');
    }
    return response.value as T;
  }

  private getApp(request: DialogRequest): App {
    if (this.app === undefined) {
      throw new Error(`No app to open the real dialog for ${describeDialogRequest(request)}: pass one to the DialogContext`);
    }
    return this.app;
  }

  private async handle(request: DialogRequest): Promise<DialogDriverResponse> {
    return this.driver === undefined ? { isHandled: false } : (await this.driver.handle(request));
  }
}

/**
 * Error thrown when a {@link DialogDriver} answers with a value the real dialog could never return.
 */
export class InvalidDialogResponseError extends Error {
  /**
   * Creates the error.
   *
   * @param request - The request the driver answered.
   * @param detail - What the value should have been.
   */
  public constructor(request: DialogRequest, detail: string) {
    super(`Invalid scripted answer for ${describeDialogRequest(request)}: ${detail}`);
    this.name = 'InvalidDialogResponseError';
  }
}

/**
 * Describes a dialog request for an error message: its kind, and its interaction id when it has one.
 *
 * @param request - The request.
 * @returns The description.
 */
export function describeDialogRequest(request: DialogRequest): string {
  return request.interactionId === undefined ? request.kind : `${request.kind} (${request.interactionId})`;
}

function createRequest<Kind extends DialogKind>(kind: Kind, params: DialogParamsMap[Kind], interactionId: string | undefined): DialogRequest {
  return (interactionId === undefined ? { kind, params } : { interactionId, kind, params }) as DialogRequest;
}
