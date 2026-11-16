/**
 * @file
 *
 * Pins what Obsidian core itself relays from the main window to a popout and back,
 * so the window helpers cover only what core does not.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

// The first block is Obsidian `1.15.1`'s popout relay list; the rest are common types it leaves out.
const EVENT_CONSTRUCTOR_NAMES: Record<string, string> = {
  auxclick: 'MouseEvent',
  blur: 'FocusEvent',
  click: 'MouseEvent',
  contextmenu: 'MouseEvent',
  copy: 'ClipboardEvent',
  cut: 'ClipboardEvent',
  drag: 'DragEvent',
  dragend: 'DragEvent',
  dragenter: 'DragEvent',
  dragleave: 'DragEvent',
  dragover: 'DragEvent',
  dragstart: 'DragEvent',
  drop: 'DragEvent',
  focus: 'FocusEvent',
  focusin: 'FocusEvent',
  focusout: 'FocusEvent',
  fullscreenchange: 'Event',
  input: 'InputEvent',
  keydown: 'KeyboardEvent',
  keyup: 'KeyboardEvent',
  mousedown: 'MouseEvent',
  mousemove: 'MouseEvent',
  mouseup: 'MouseEvent',
  paste: 'ClipboardEvent',
  pointerdown: 'PointerEvent',
  pointermove: 'PointerEvent',
  pointerup: 'PointerEvent',
  resize: 'UIEvent',
  selectionchange: 'Event',
  wheel: 'WheelEvent'
};

const RELAYED_EVENT_TYPES = new Set([
  'auxclick',
  'click',
  'contextmenu',
  'copy',
  'cut',
  'drag',
  'dragend',
  'dragenter',
  'dragleave',
  'dragover',
  'dragstart',
  'drop',
  'fullscreenchange',
  'keydown',
  'keyup',
  'mousedown',
  'mousemove',
  'mouseup',
  'paste'
]);

interface EventRelayResult {
  readonly isOnMainDocument: boolean;
  readonly isOnMainWindow: boolean;
}

describe('core popout relay', () => {
  it('should relay main-body classes, main-head style elements and a fixed set of events, but not adopted style sheets', async () => {
    const result = await evalInObsidian({
      async callback({ app, eventConstructorNames, lib: { castTo, getMainWindow, waitUntil } }) {
        const mainWindow = castTo<typeof window>(getMainWindow(app));
        const leaf = app.workspace.openPopoutLeaf();
        const popoutWindow = castTo<typeof window>(leaf.getContainer().win);
        const className = 'obsidian-lib-core-relay-probe';
        const styleEl = mainWindow.document.createElement('style');
        styleEl.id = 'obsidian-lib-core-relay-probe-style';
        styleEl.textContent = '.obsidian-lib-core-relay-probe-style { color: red; }';
        const adoptedSheet = new mainWindow.CSSStyleSheet();
        adoptedSheet.replaceSync('.obsidian-lib-core-relay-probe-adopted { color: red; }');
        const eventResults: Record<string, EventRelayResult> = {};
        try {
          await waitUntil({ message: 'popout ready', predicate: () => popoutWindow.document.readyState === 'complete' });

          mainWindow.document.body.classList.add(className);
          await waitUntil({ message: 'class relayed', predicate: () => popoutWindow.document.body.classList.contains(className) });
          mainWindow.document.body.classList.remove(className);
          await waitUntil({ message: 'class removal relayed', predicate: () => !popoutWindow.document.body.classList.contains(className) });

          mainWindow.document.head.append(styleEl);
          await waitUntil({ message: 'style element relayed', predicate: () => popoutWindow.document.head.querySelector(`#${styleEl.id}`) !== null });

          mainWindow.document.adoptedStyleSheets = [...mainWindow.document.adoptedStyleSheets, adoptedSheet];
          // Core's relay is a MutationObserver; a style element appended after the sheet is relayed only once that observer ran.
          const markerEl = mainWindow.document.createElement('style');
          markerEl.id = 'obsidian-lib-core-relay-probe-marker';
          mainWindow.document.head.append(markerEl);
          await waitUntil({ message: 'marker relayed', predicate: () => popoutWindow.document.head.querySelector(`#${markerEl.id}`) !== null });
          markerEl.remove();
          const isAdoptedSheetRelayed = popoutWindow.document.adoptedStyleSheets.some((sheet) => [...sheet.cssRules].some((rule) => rule.cssText.includes('obsidian-lib-core-relay-probe-adopted')));

          const mainWindowEventTypes = new Set<string>();
          const mainDocumentEventTypes = new Set<string>();
          function onWindow($event: Event): void {
            mainWindowEventTypes.add($event.type);
          }
          function onDocument($event: Event): void {
            mainDocumentEventTypes.add($event.type);
          }

          for (const [type, constructorName] of Object.entries(eventConstructorNames)) {
            mainWindow.addEventListener(type, onWindow, { capture: true });
            mainWindow.document.addEventListener(type, onDocument, { capture: true });
            const EventConstructor = castTo<Record<string, typeof Event | undefined>>(popoutWindow)[constructorName] ?? popoutWindow.Event;
            // Dispatched, not trusted: core's relay is a capture listener on the popout window that copies any event,
            // And a trusted copy, paste, drag or fullscreen change cannot be produced from a test.
            popoutWindow.document.body.dispatchEvent(new EventConstructor(type, { bubbles: true }));
            mainWindow.removeEventListener(type, onWindow, { capture: true });
            mainWindow.document.removeEventListener(type, onDocument, { capture: true });
            eventResults[type] = { isOnMainDocument: mainDocumentEventTypes.has(type), isOnMainWindow: mainWindowEventTypes.has(type) };
          }

          return {
            eventResults,
            isAdoptedSheetRelayed
          };
        } finally {
          mainWindow.document.body.classList.remove(className);
          styleEl.remove();
          mainWindow.document.adoptedStyleSheets = mainWindow.document.adoptedStyleSheets.filter((sheet) => sheet !== adoptedSheet);
          leaf.detach();
          window.activeWindow = mainWindow;
          window.activeDocument = mainWindow.document;
        }
      },
      input: { eventConstructorNames: EVENT_CONSTRUCTOR_NAMES }
    });

    const expectedEventResults = Object.fromEntries(
      Object.keys(EVENT_CONSTRUCTOR_NAMES).map((type) => [type, { isOnMainDocument: false, isOnMainWindow: RELAYED_EVENT_TYPES.has(type) }])
    );
    expect(result).toStrictEqual({
      eventResults: expectedEventResults,
      isAdoptedSheetRelayed: false
    });
  });
});
