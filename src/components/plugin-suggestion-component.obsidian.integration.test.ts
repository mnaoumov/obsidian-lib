import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

describe('PluginSuggestionComponent notice', () => {
  it('should space the action button apart from the decline button', async () => {
    const gapInPixels = await evalInObsidian({
      callback({ lib: { CssClass }, obsidianModule: { ButtonComponent } }) {
        const buttonsEl = activeDocument.body.createDiv({
          cls: [CssClass.LibraryName, CssClass.LegacyLibraryName, CssClass.PluginSuggestionNoticeButtons]
        });
        try {
          const actionButton = new ButtonComponent(buttonsEl).setButtonText('Install and enable').setCta();
          const declineButton = new ButtonComponent(buttonsEl).setButtonText('Not now');
          return declineButton.buttonEl.getBoundingClientRect().left - actionButton.buttonEl.getBoundingClientRect().right;
        } finally {
          buttonsEl.remove();
        }
      }
    });

    expect(gapInPixels).toBeGreaterThan(0);
  });
});
