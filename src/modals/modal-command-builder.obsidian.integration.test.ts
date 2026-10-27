/**
 * @file
 *
 * Verifies modal toggle colors against Obsidian's real button styles and pointer states.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

describe('modal command toggle fill', () => {
  it.each([
    { isMobile: false, shouldHover: false },
    { isMobile: true, shouldHover: false },
    { isMobile: false, shouldHover: true },
    { isMobile: true, shouldHover: true }
  ])('keeps the accent fill while focused ($isMobile mobile, $shouldHover hover)', async ({ isMobile, shouldHover }) => {
    const result = await evalInObsidian({
      async callback({ app, isMobile: shouldUseMobileStyles, lib: { clickElement, hoverElement, ModalCommandBuilder, ModalCommandsRenderMode, unhoverElement, waitUntil }, obsidianModule: { Modal }, shouldHover: shouldHoverButton }) {
        const hasMobileClass = document.body.hasClass('is-mobile');
        const modal = new Modal(app);
        document.body.toggleClass('is-mobile', shouldUseMobileStyles);
        modal.open();

        try {
          let isOn = false;
          const commands = new ModalCommandBuilder()
            .addCheckbox({
              key: '1',
              onChange: (value) => {
                isOn = value;
              },
              onInit: (checkboxEl) => {
                checkboxEl.checked = false;
              },
              purpose: 'Toggle'
            })
            .build(modal, { renderMode: ModalCommandsRenderMode.Buttons });
          const buttonEl = modal.modalEl.querySelector('button.modal-command');
          if (!(buttonEl instanceof HTMLButtonElement)) {
            throw new TypeError('The toggle button was not rendered.');
          }

          const referenceEl = modal.modalEl.createDiv();
          // eslint-disable-next-line obsidianmd/no-static-styles-assignment -- A reference swatch resolves the theme variables independently of the button selectors under test.
          referenceEl.setCssProps({
            'background-color': 'var(--interactive-accent)',
            'color': 'var(--text-on-accent)'
          });
          await unhoverElement({ element: buttonEl });
          buttonEl.focus();
          await clickElement({ element: buttonEl });
          await waitUntil({ predicate: () => isOn, timeoutInMilliseconds: 2000 });
          commands.refresh();
          if (shouldHoverButton) {
            await hoverElement({ element: buttonEl });
          } else {
            await unhoverElement({ element: buttonEl });
          }
          // Mobile button colors transition. Assert the settled fill, not the first animation frame.
          await Promise.all(buttonEl.getAnimations().map((animation) => animation.finished));

          return {
            background: getComputedStyle(buttonEl).backgroundColor,
            color: getComputedStyle(buttonEl).color,
            expectedBackground: getComputedStyle(referenceEl).backgroundColor,
            expectedColor: getComputedStyle(referenceEl).color,
            isActive: buttonEl.hasClass('is-active'),
            isFocused: document.activeElement === buttonEl,
            isHovered: buttonEl.matches(':hover'),
            isPressed: buttonEl.getAttribute('aria-pressed')
          };
        } finally {
          modal.close();
          document.body.toggleClass('is-mobile', hasMobileClass);
        }
      },
      input: { isMobile, shouldHover }
    });

    expect(result.isFocused).toBe(true);
    expect(result.isHovered).toBe(shouldHover);
    expect(result.isActive).toBe(true);
    expect(result.isPressed).toBe('true');
    expect(result.background).toBe(result.expectedBackground);
    expect(result.color).toBe(result.expectedColor);
  });
});
