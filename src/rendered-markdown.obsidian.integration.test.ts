/**
 * @file
 *
 * Integration tests for the Reading-view behavior ported to standalone rendered markdown: the footnote
 * click, and heading and list folding. Real markdown rendered by Obsidian, clicked with trusted input.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import type { GenericObject } from '@mnaoumov/typescript-lib/type-guards';

import { join } from 'node:path';
import { evalInObsidian } from 'obsidian-integration-testing';
import { compile } from 'sass';
import {
  describe,
  expect,
  it
} from 'vitest';

interface FoldArguments {
  readonly libraryStyles: string;
}

interface FoldResult {
  readonly blockTexts: readonly string[];
  readonly hiddenAfterHeadingFold: readonly string[];
  readonly hiddenAfterHeadingUnfold: readonly string[];
  readonly nestedListDisplayAfterListFold: string;
  readonly nestedListDisplayAfterListUnfold: string;
}

interface FootnoteResult {
  readonly hashAfter: string;
  readonly hashBefore: string;
  readonly isFootnoteFlashing: boolean;
  readonly isReferenceFlashingAfterBack: boolean;
}

describe('rendered markdown', () => {
  it('should scroll a footnote link to its footnote and back, without touching the location hash', async () => {
    const result = await evalInObsidian<Record<string, never>, FootnoteResult>({
      async callback({
        app,
        lib: { clickElement, fullRender, waitUntil }
      }) {
        const FLASH_TIMEOUT_IN_MILLISECONDS = 5000;

        const el = createDiv();
        // Floated above the app so the trusted click hit-tests onto the link itself.
        el.setCssStyles({
          background: 'var(--background-primary)',
          left: '40px',
          maxHeight: '400px',
          overflow: 'auto',
          position: 'fixed',
          top: '40px',
          width: '400px',
          zIndex: '9999'
        });
        document.body.append(el);

        try {
          await fullRender({
            app,
            el,
            markdown: 'Text with a note[^1].\n\n[^1]: The note.',
            shouldRegisterLinkHandlers: true
          });

          const hashBefore = window.location.hash;
          const referenceLinkEl = el.find('sup a.footnote-link');
          await clickElement({ element: referenceLinkEl });
          const footnoteEl = el.find('li[data-footnote-id]');
          await waitUntil({
            message: 'the footnote to flash after its reference was clicked',
            predicate: () => footnoteEl.hasClass('is-flashing'),
            timeoutInMilliseconds: FLASH_TIMEOUT_IN_MILLISECONDS
          });
          const isFootnoteFlashing = footnoteEl.hasClass('is-flashing');

          await clickElement({ element: el.find('a.footnote-backref') });
          const referenceEl = el.find('sup[data-footnote-id]');
          await waitUntil({
            message: 'the reference to flash after the back link was clicked',
            predicate: () => referenceEl.hasClass('is-flashing'),
            timeoutInMilliseconds: FLASH_TIMEOUT_IN_MILLISECONDS
          });

          return {
            hashAfter: window.location.hash,
            hashBefore,
            isFootnoteFlashing,
            isReferenceFlashingAfterBack: referenceEl.hasClass('is-flashing')
          };
        } finally {
          el.detach();
        }
      }
    });

    expect(result.isFootnoteFlashing).toBe(true);
    expect(result.isReferenceFlashingAfterBack).toBe(true);
    expect(result.hashAfter).toBe(result.hashBefore);
  });

  it('should fold headings and lists of markdown rendered with fold handlers', async () => {
    type FoldInput = GenericObject<FoldArguments>;
    // The harness bundles this package's sources, whose `LIBRARY_STYLES` is still the unstamped
    // placeholder, and its plugin is a plain `Plugin` that injects nothing. So the stylesheet the list fold
    // depends on is compiled here and handed in.
    const { css: libraryStyles } = compile(join(import.meta.dirname, 'styles', 'main.scss'));
    const result = await evalInObsidian<FoldInput, FoldResult>({
      async callback({
        app,
        lib: {
          clickElement,
          fullRender,
          waitUntil
        },
        libraryStyles: css
      }) {
        const FOLD_TIMEOUT_IN_MILLISECONDS = 5000;

        // An adopted sheet rather than a <style> element, which the Obsidian lint rules forbid.
        const styleSheet = new CSSStyleSheet();
        styleSheet.replaceSync(css);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, styleSheet];

        const el = createDiv();
        // Padded so the indicators, which sit in the margin left of their heading or item, stay on screen.
        el.setCssStyles({
          background: 'var(--background-primary)',
          left: '40px',
          paddingLeft: '60px',
          position: 'fixed',
          top: '40px',
          width: '400px',
          zIndex: '9999'
        });
        document.body.append(el);

        function getHiddenBlockTexts(): string[] {
          return el.findAll(':scope > *').filter((block) => block.style.display === 'none').map((block) => block.getText().trim());
        }

        try {
          await fullRender({
            app,
            el,
            markdown: '# One\n\nalpha\n\n## Two\n\nbeta\n\n# Three\n\n- outer\n  - inner',
            shouldRegisterFoldHandlers: true
          });

          // The first word of each block names it; a list block's text runs on over its nested items.
          const blockTexts = el.findAll(':scope > *').map((block) => block.getText().trim().split(/\s+/, 1)[0] ?? '');

          const headingEl = el.find('h1');
          await clickElement({ element: el.find('h1 > .heading-collapse-indicator') });
          await waitUntil({
            message: 'the first heading to fold',
            predicate: () => headingEl.hasClass('is-collapsed'),
            timeoutInMilliseconds: FOLD_TIMEOUT_IN_MILLISECONDS
          });
          const hiddenAfterHeadingFold = getHiddenBlockTexts();

          await clickElement({ element: el.find('h1 > .heading-collapse-indicator') });
          await waitUntil({
            message: 'the first heading to unfold',
            predicate: () => !headingEl.hasClass('is-collapsed'),
            timeoutInMilliseconds: FOLD_TIMEOUT_IN_MILLISECONDS
          });
          const hiddenAfterHeadingUnfold = getHiddenBlockTexts();

          const listItemEl = el.find('li');
          const nestedListEl = el.find('li > ul');
          await clickElement({ element: el.find('li > .list-collapse-indicator') });
          await waitUntil({
            message: 'the list item to fold',
            predicate: () => listItemEl.hasClass('is-collapsed'),
            timeoutInMilliseconds: FOLD_TIMEOUT_IN_MILLISECONDS
          });
          const nestedListDisplayAfterListFold = getComputedStyle(nestedListEl).display;

          await clickElement({ element: el.find('li > .list-collapse-indicator') });
          await waitUntil({
            message: 'the list item to unfold',
            predicate: () => !listItemEl.hasClass('is-collapsed'),
            timeoutInMilliseconds: FOLD_TIMEOUT_IN_MILLISECONDS
          });

          return {
            blockTexts,
            hiddenAfterHeadingFold,
            hiddenAfterHeadingUnfold,
            nestedListDisplayAfterListFold,
            nestedListDisplayAfterListUnfold: getComputedStyle(nestedListEl).display
          };
        } finally {
          el.detach();
          document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== styleSheet);
        }
      },
      input: { libraryStyles }
    });

    expect(result.blockTexts).toEqual(['One', 'alpha', 'Two', 'beta', 'Three', 'outer']);
    expect(result.hiddenAfterHeadingFold).toEqual(['alpha', 'Two', 'beta']);
    expect(result.hiddenAfterHeadingUnfold).toEqual([]);
    expect(result.nestedListDisplayAfterListFold).toBe('none');
    expect(result.nestedListDisplayAfterListUnfold).toBe('block');
  });
});
