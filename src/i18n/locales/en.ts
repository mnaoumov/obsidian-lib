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
    buttons: {
      cancel: 'Cancel',
      ok: 'OK'
    },
    callout: {
      loadContent: 'Load content for callout'
    },
    dataview: {
      itemsPerPage: 'Items per page:',
      jumpToPage: 'Jump to page:',
      pageHeader: 'Page {{pageNumber, number}} of {{totalPages, number}}, Total items: {{totalItems, number}}'
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
