/**
 * @file
 *
 * Proves window registration and imported Obsidian APIs in real popouts.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createServer } from 'node:http';
import { evalInObsidian } from 'obsidian-integration-testing';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.end('popout request succeeded');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe('all-window registrations', () => {
  it('should cover existing and later popouts, clean up on close and unload, and use imported APIs from a popout', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { forEachWindow, getMainWindow, registerBodyClass, waitUntil }, obsidianModule: { Component, Notice, requestUrl }, url: requestUrlValue }) {
        const mainWindow = getMainWindow(app);
        const className = 'obsidian-lib-window-probe';
        const owner = new Component();
        owner.load();
        const firstLeaf = app.workspace.openPopoutLeaf();
        const firstWindow = firstLeaf.getContainer().win;
        let secondLeaf: null | ReturnType<typeof app.workspace.openPopoutLeaf> = null;
        const attached = new Set<Window>();
        const cleaned = new Set<Window>();
        try {
          await waitUntil({ message: 'existing popout ready', predicate: () => firstWindow.document.readyState === 'complete' });
          window.activeWindow = firstWindow;
          window.activeDocument = firstWindow.document;
          forEachWindow({
            app,
            callback(win): () => void {
              attached.add(win);
              return () => {
                cleaned.add(win);
              };
            },
            component: owner
          });
          registerBodyClass({ app, className, component: owner });
          await waitUntil({ message: 'existing popout body class', predicate: () => firstWindow.document.body.classList.contains(className) });
          const isMainCovered = attached.has(mainWindow) && mainWindow.document.body.classList.contains(className);
          const isExistingCovered = attached.has(firstWindow);

          const notice = new Notice('Popout API probe', 0);
          const isNoticeInPopout = notice.messageEl.ownerDocument === firstWindow.document;
          notice.hide();
          const response = await requestUrl(requestUrlValue);

          secondLeaf = app.workspace.openPopoutLeaf();
          const secondWindow = secondLeaf.getContainer().win;
          await waitUntil({ message: 'later popout body class', predicate: () => secondWindow.document.body.classList.contains(className) });
          const isLaterCovered = attached.has(secondWindow);
          secondLeaf.detach();
          secondLeaf = null;
          await waitUntil({ message: 'closed popout cleanup', predicate: () => cleaned.has(secondWindow) });

          owner.unload();
          return {
            existingCovered: isExistingCovered,
            laterCovered: isLaterCovered,
            mainCovered: isMainCovered,
            noticeInPopout: isNoticeInPopout,
            remainingClass: [mainWindow, firstWindow].some((win) => win.document.body.classList.contains(className)),
            requestText: response.text,
            wereAllCleaned: [...attached].every((win) => cleaned.has(win))
          };
        } finally {
          owner.unload();
          window.activeWindow = mainWindow;
          window.activeDocument = mainWindow.document;
          secondLeaf?.detach();
          firstLeaf.detach();
        }
      },
      input: { url }
    });

    expect(result).toStrictEqual({
      existingCovered: true,
      laterCovered: true,
      mainCovered: true,
      noticeInPopout: true,
      remainingClass: false,
      requestText: 'popout request succeeded',
      wereAllCleaned: true
    });
  });
});
