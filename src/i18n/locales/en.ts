/**
 * @file
 *
 * This file defines the English translations for the `i18n` module.
 */

/**
 * The English translations.
 */
export const en = {
  obsidianLib: {
    asyncWithNotice: {
      milliseconds: 'milliseconds...',
      operation: 'Operation',
      runningFor: 'Running for',
      terminateOperation: 'You can terminate the operation by clicking the button below, but be aware it might leave the vault in an inconsistent state.',
      timedOut: 'The operation timed out after {{duration, number}} milliseconds.'
    },
    bugReport: {
      clipboardCopied: 'The bug report is too long for a link, so it was copied to your clipboard. Paste it into the Environment field of the form that opens.',
      continue: 'Continue',
      copyManuallyMessage: 'The bug report is too long for a link, and it could not be copied to your clipboard. Copy the text below, then paste it into the Environment field of the form that opens.',
      copyManuallyTitle: 'Copy the bug report',
      openIssueForm: 'Open the issue form',
      potentiallyPrivate: 'Can contain private data, such as file names, notes or secrets. Left out unless you switch it on.',
      previewHeading: 'This exact text will be put into the issue form. Nothing is sent until you submit the form on GitHub.',
      reviewMessage: 'Choose which diagnostics to include in the bug report. Logs and settings can contain private data, such as file names, note content, tokens or passwords: check the preview before you continue.',
      reviewTitle: 'Review the bug report'
    },
    bulkOperation: {
      noOperations: 'No bulk operation of this plugin was found in the vault repository.',
      notActive: 'Bulk operation commits are off, or the vault is not in a git repository.',
      recoveredInterrupted: 'A bulk operation was interrupted. Its changes were committed as {{operationId}} interrupted.',
      resumedAfterRecovery: 'The lock of {{recoveredOperationId}} went stale while it ran, so its changes so far were committed as {{recoveredOperationId}} interrupted, and the rest as {{operationId}}. Undoing the whole operation takes reverting both.',
      revertConflict: 'Reverting {{operationId}} stopped on a conflict. The vault repository is left mid-revert: resolve the conflicts, then run git revert --continue, or git revert --abort to give up.',
      reverted: 'Reverted {{operationId}}.',
      revertFailed: 'Failed to revert {{operationId}}: {{error}}',
      selectOperation: 'Select a bulk operation to undo'
    },
    buttons: {
      cancel: 'Cancel',
      ok: 'OK'
    },
    callout: {
      loadContent: 'Load content for callout'
    },
    codeBlockBuilder: {
      copied: 'Code block copied to the clipboard.',
      copy: 'Copy the code block',
      copyFailed: 'Failed to copy the code block to the clipboard.',
      insert: 'Insert into the note',
      insertUnavailable: 'Open a note in an editor to insert the code block.',
      invalidValue: 'The value does not match the expected pattern.',
      output: 'Output',
      reset: 'Reset to {{value}}',
      rootFolder: '(vault root)',
      title: 'Code block builder'
    },
    dataview: {
      itemsPerPage: 'Items per page:',
      jumpToPage: 'Jump to page:',
      pageHeader: 'Page {{pageNumber, number}} of {{totalPages, number}}, Total items: {{totalItems, number}}'
    },
    hotkey: {
      clear: 'Clear hotkey',
      notSet: 'Not set',
      pressHotkey: 'Press a hotkey...'
    },
    list: {
      add: 'Add',
      empty: 'No items',
      moveDown: 'Move down',
      moveUp: 'Move up',
      remove: 'Remove'
    },
    menu: {
      copy: 'Copy'
    },
    metadataCache: {
      getBacklinksForFilePath: 'Get backlinks for {{filePath}}'
    },
    notices: {
      attachmentIsStillUsed: 'Attachment {{attachmentPath}} is still used by other notes. It will not be deleted.',
      attachmentRescued: 'Attachment {{attachmentPath}} is still used by other notes. It was moved to {{newAttachmentPath}}.',
      closeAriaLabel: 'Close',
      failedToOpenUrl: 'Failed to open {{url}}',
      unhandledError: 'An unhandled error occurred. Please check the console for more information.'
    },
    pathSettings: {
      invalidGlob: 'Invalid glob pattern: {{glob}} ({{reason}})',
      invalidRegularExpression: 'Invalid regular expression: {{regExp}} ({{reason}})',
      trailingEscape: 'it ends with an unescaped \\',
      unclosedCharacterClass: 'a [ character class is never closed with ]'
    },
    pluginConflict: {
      blockedNotice: '{{pluginName}} does nothing while {{conflictingPluginName}} is enabled. Update or disable it to continue.',
      conflictAppearedNotice: '{{conflictingPluginName}} is now enabled, so {{pluginName}} has stopped working. Update or disable it to resume.',
      disable: 'Disable {{conflictingPluginName}}',
      settingsHeading: 'Conflicting plugin',
      warningNotice: '{{pluginName}} and {{conflictingPluginName}} overlap, and both are running.'
    },
    pluginDependency: {
      alreadyUpToDate: '{{dependencyPluginName}} is already at its latest release. {{pluginName}} needs a version that has not been released yet.',
      blockedNotice: '{{pluginName}} does nothing until {{dependencyPluginName}} is installed and enabled.',
      dependencyLostNotice: '{{dependencyPluginName}} is no longer available, so {{pluginName}} has stopped working. Bring it back to resume.',
      noReadableApiNotice: '{{dependencyPluginName}} is enabled but publishes no API {{pluginName}} can read, so {{pluginName}} does nothing. Update {{dependencyPluginName}} to resume.',
      openDependencySettings: 'Open {{dependencyPluginName}} settings',
      settingsHeading: 'Required plugin missing',
      update: 'Update {{dependencyPluginName}}',
      updated: '{{dependencyPluginName}} is updated.',
      updateFailed: 'Failed to update {{dependencyPluginName}}. Check the console for more information.',
      versionMismatchNotice: '{{pluginName}} needs a newer version of {{dependencyPluginName}}. Update it to resume.'
    },
    pluginSuggestion: {
      enable: 'Enable',
      install: 'Install and enable',
      installed: '{{pluginName}} is installed and enabled.',
      installFailed: 'Failed to install {{pluginName}}. Check the console for more information.',
      notNow: 'Not now'
    },
    queue: {
      flushQueue: 'Flush queue'
    },
    releaseAsset: {
      consentMessage: '{{fileName}} ({{size}}) will be downloaded from {{host}} and kept on this device, so it is downloaded only once.',
      consentMessageUnknownSize: '{{fileName}} will be downloaded from {{host}} and kept on this device, so it is downloaded only once.',
      consentTitle: 'Download {{fileName}}?',
      download: 'Download'
    },
    releaseNotes: {
      title: '{{pluginName}} release notes'
    },
    renameDeleteHandler: {
      handleDelete: 'Handle delete: {{filePath}}',
      handleOrphanedRenames: 'Handle orphaned renames',
      handleRename: 'Handle rename: {{oldPath}} -> {{newPath}}',
      updatedLinks: 'Updated {{linksCount, number}} links in {{filesCount, number}} files.'
    },
    resourceLock: {
      lockedByTooltip: 'Locked by',
      lockedNoteTooltip: 'This note is locked while an operation is in progress.',
      unlockConfirmMessage: 'This will cancel the operation(s) currently holding a lock on this note and may leave the vault in an inconsistent state. The note is locked by:',
      unlockConfirmTitle: 'Unlock note?',
      unlockMenuItem: 'Unlock'
    },
    validation: {
      controlCharacter: '{{name}} contains a control character.',
      emptyName: 'The name is empty.',
      trailingCharacters: '{{name}} ends with a dot or a space, which Windows removes.',
      unsafeCharacters: '{{name}} contains characters that are not allowed: {{characters}}',
      windowsReservedName: '{{name}} is a device name Windows reserves, so the file cannot exist on Windows.'
    },
    vault: {
      processFile: 'Process file {{filePath}}'
    }
  }
} as const;
