/**
 * @file
 *
 * Integration tests for {@link StyleSheetComponent}, against a live Obsidian instance.
 *
 * Only a real renderer proves the two points the unit tests cannot: a sheet constructed in one window's realm is
 * refused by another window's document, so each popout needs its own; and a popout opened after the component
 * loaded is styled too. Popouts exist on desktop only.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

interface ProbeWidths {
  readonly mainAfterUnload: string;
  readonly mainLoaded: string;
  readonly popoutAfterUnload: string;
  readonly popoutLoaded: string;
  readonly popoutUpdated: string;
}

describe('StyleSheetComponent', () => {
  it('should style the main window and a popout opened later, follow setCss, and remove the sheet on unload', async () => {
    const result = await evalInObsidian<Record<string, never>, ProbeWidths>({
      async callback({ app, lib: { StyleSheetComponent, waitUntil } }) {
        const PROBE_CLASS = 'style-sheet-component-probe';

        function readWidth(doc: Document): string {
          const probe = doc.body.createDiv({ cls: PROBE_CLASS });
          try {
            return doc.defaultView?.getComputedStyle(probe).borderTopWidth ?? '';
          } finally {
            probe.remove();
          }
        }

        const component = new StyleSheetComponent({
          app,
          css: `.${PROBE_CLASS} { border-top: 7px solid; }`
        });
        component.load();
        let isLoaded = true;
        const leaf = app.workspace.openPopoutLeaf();
        try {
          const popoutDocument = leaf.getContainer().doc;
          await waitUntil({ message: 'the popout to load', predicate: () => popoutDocument.readyState === 'complete' });
          await waitUntil({ message: 'the popout to be styled', predicate: () => readWidth(popoutDocument) === '7px' });

          const mainLoaded = readWidth(document);
          const popoutLoaded = readWidth(popoutDocument);

          component.setCss(`.${PROBE_CLASS} { border-top: 3px solid; }`);
          const popoutUpdated = readWidth(popoutDocument);

          component.unload();
          isLoaded = false;

          return {
            mainAfterUnload: readWidth(document),
            mainLoaded,
            popoutAfterUnload: readWidth(popoutDocument),
            popoutLoaded,
            popoutUpdated
          };
        } finally {
          if (isLoaded) {
            component.unload();
          }
          leaf.detach();
        }
      }
    });

    expect(result).toStrictEqual({
      mainAfterUnload: '0px',
      mainLoaded: '7px',
      popoutAfterUnload: '0px',
      popoutLoaded: '7px',
      popoutUpdated: '3px'
    });
  });
});
