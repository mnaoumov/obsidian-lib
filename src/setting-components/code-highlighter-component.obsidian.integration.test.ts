/**
 * @file
 *
 * Verifies that the highlighted overlay of `CodeHighlighterComponent` lays its text out exactly like the
 * transparent textarea above it, with Obsidian's real desktop and mobile textarea styles.
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

interface BoxMetrics {
  readonly clientWidth: number;
  readonly contentLeft: number;
  readonly contentTop: number;
  readonly fontSize: string;
  readonly offsetWidth: number;
  readonly overflowWrap: string;
  readonly padding: string;
  readonly tabSize: string;
  readonly whiteSpace: string;
  readonly wordBreak: string;
}

interface LayoutArguments {
  readonly isMobile: boolean;
  readonly libraryStyles: string;
}

interface LayoutResult {
  readonly codeFontSize: string;
  readonly mirrorLineStarts: readonly number[];
  readonly overlayBox: BoxMetrics;
  readonly overlayLineStarts: readonly number[];
  readonly textAreaBox: BoxMetrics;
}

describe('CodeHighlighterComponent overlay layout', () => {
  // The harness bundles this package's sources, whose `LIBRARY_STYLES` is still the unstamped placeholder,
  // So the component stylesheet is compiled here and handed in.
  const { css: libraryStyles } = compile(join(import.meta.dirname, '..', 'styles', 'main.scss'));

  it.each([
    { isMobile: false },
    { isMobile: true }
  ])('wraps the overlay at the same characters as the textarea ($isMobile mobile)', async ({ isMobile }) => {
    const result = await evalInObsidian<GenericObject<LayoutArguments>, LayoutResult>({
      async callback({ isMobile: shouldUseMobileStyles, lib: { CodeHighlighterComponent, waitUntil }, libraryStyles: css }) {
        const hasMobileClass = document.body.hasClass('is-mobile');
        document.body.toggleClass('is-mobile', shouldUseMobileStyles);
        // An adopted sheet rather than a <style> element, which the Obsidian lint rules forbid.
        const styleSheet = new CSSStyleSheet();
        styleSheet.replaceSync(css);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, styleSheet];

        const containerEl = createDiv();
        containerEl.setCssStyles({
          background: 'var(--background-primary)',
          left: '40px',
          position: 'fixed',
          top: '40px',
          zIndex: '9999'
        });
        document.body.append(containerEl);

        function getBoxMetrics(el: HTMLElement): BoxMetrics {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return {
            clientWidth: el.clientWidth,
            contentLeft: rect.left + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft),
            contentTop: rect.top + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.paddingTop),
            fontSize: style.fontSize,
            offsetWidth: el.offsetWidth,
            overflowWrap: style.overflowWrap,
            padding: style.padding,
            tabSize: style.tabSize,
            whiteSpace: style.whiteSpace,
            wordBreak: style.wordBreak
          };
        }

        function getLineStarts(el: HTMLElement): number[] {
          const lineStarts: number[] = [];
          const range = document.createRange();
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let index = 0;
          let lastTop = -Infinity;
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.textContent ?? '';
            for (let offset = 0; offset < text.length; offset++, index++) {
              if (text[offset] === '\n') {
                continue;
              }
              range.setStart(node, offset);
              range.setEnd(node, offset + 1);
              const top = range.getClientRects()[0]?.top;
              if (top === undefined || !(top > lastTop + 1)) {
                continue;
              }

              lineStarts.push(index);
              lastTop = top;
            }
          }
          return lineStarts;
        }

        try {
          const component = new CodeHighlighterComponent(containerEl);
          // A long unbroken line that must wrap, and enough lines that the textarea scrolls.
          const value = [
            '{trim:{side:\'left\',chars:\'-\'},replace:{from:\'attachments\',to:\'files\'},lower:true}',
            ...Array.from({ length: 20 }, (_, index) => `line ${String(index)} with some words that wrap around the narrow box`)
          ].join('\n');
          component.setValue(value);
          const preEl = containerEl.find('pre');
          const codeEl = preEl.find('code');
          await waitUntil({
            message: 'the overlay to render the value',
            predicate: () => codeEl.textContent === value && preEl.style.getPropertyValue('--bottom-gap') !== '',
            timeoutInMilliseconds: 5000
          });

          const textAreaEl = component.inputEl;
          const textAreaStyle = getComputedStyle(textAreaEl);
          // The textarea exposes no per-character geometry, so a div with its text styles and its content width
          // Stands in for its wrapping.
          const mirrorEl = containerEl.createDiv();
          mirrorEl.setCssStyles({
            fontFamily: textAreaStyle.fontFamily,
            fontSize: textAreaStyle.fontSize,
            left: '0',
            letterSpacing: textAreaStyle.letterSpacing,
            lineHeight: textAreaStyle.lineHeight,
            overflowWrap: textAreaStyle.overflowWrap,
            position: 'absolute',
            tabSize: textAreaStyle.tabSize,
            top: '0',
            visibility: 'hidden',
            whiteSpace: textAreaStyle.whiteSpace,
            width: `${String(textAreaEl.clientWidth - Number.parseFloat(textAreaStyle.paddingLeft) - Number.parseFloat(textAreaStyle.paddingRight))}px`,
            wordBreak: textAreaStyle.wordBreak
          });
          mirrorEl.textContent = value;

          return {
            codeFontSize: getComputedStyle(codeEl).fontSize,
            mirrorLineStarts: getLineStarts(mirrorEl),
            overlayBox: getBoxMetrics(preEl),
            overlayLineStarts: getLineStarts(codeEl),
            textAreaBox: getBoxMetrics(textAreaEl)
          };
        } finally {
          containerEl.detach();
          document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== styleSheet);
          document.body.toggleClass('is-mobile', hasMobileClass);
        }
      },
      input: { isMobile, libraryStyles }
    });

    expect(result.overlayBox).toEqual(result.textAreaBox);
    expect(result.codeFontSize).toBe(result.textAreaBox.fontSize);
    expect(result.overlayLineStarts.length).toBeGreaterThan(21);
    expect(result.overlayLineStarts).toEqual(result.mirrorLineStarts);
  });
});
