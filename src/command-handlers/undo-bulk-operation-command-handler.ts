/**
 * @file
 *
 * Handles the "Undo a bulk operation..." command.
 */

import { Platform } from 'obsidian';

import type { BulkOperationCommitComponent } from '../components/bulk-operation-commit-component.ts';

import { GlobalCommandHandler } from './global-command-handler.ts';

/**
 * Constructor parameters for {@link UndoBulkOperationCommandHandler}.
 */
export interface UndoBulkOperationCommandHandlerConstructorParams {
  /**
   * The component that commits the plugin's bulk operations.
   */
  readonly bulkOperationCommitComponent: BulkOperationCommitComponent;

  /**
   * Whether the plugin's opt-in setting for bulk-operation commits is on. The command is hidden while it is off.
   */
  readonly isEnabled: () => boolean;
}

/**
 * A command handler that lists the plugin's bulk operations recorded in the vault repository and reverts the one
 * the user picks. Available only on desktop, while the plugin's bulk-operation commits are enabled.
 */
export class UndoBulkOperationCommandHandler extends GlobalCommandHandler {
  /**
   * The component that commits the plugin's bulk operations.
   */
  protected readonly bulkOperationCommitComponent: BulkOperationCommitComponent;

  /**
   * Whether the plugin's opt-in setting for bulk-operation commits is on.
   */
  protected readonly isEnabled: () => boolean;

  /**
   * Creates a new instance.
   *
   * @param params - Constructor parameters.
   */
  public constructor(params: UndoBulkOperationCommandHandlerConstructorParams) {
    super({
      icon: 'undo-2',
      id: 'undo-bulk-operation',
      name: 'Undo a bulk operation...'
    });
    this.bulkOperationCommitComponent = params.bulkOperationCommitComponent;
    this.isEnabled = params.isEnabled;
  }

  /**
   * Executes the command, letting the user pick a bulk operation to revert.
   */
  public override async execute(): Promise<void> {
    await this.bulkOperationCommitComponent.undoBulkOperation();
  }

  /**
   * Checks whether the command can currently execute: on desktop, with bulk-operation commits enabled.
   *
   * @returns Whether the command can execute.
   */
  protected override canExecute(): boolean {
    return Platform.isDesktopApp && this.isEnabled();
  }
}
