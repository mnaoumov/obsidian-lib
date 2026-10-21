/**
 * @file
 *
 * Integration test harness plugin.
 *
 * Imports the entire `@mnaoumov/obsidian-lib` library and exposes it as a strongly
 * typed namespace on `window.__obsidianLibModule`. This allows
 * `evalInObsidian` callbacks to access any part of the library.
 */

/// <reference path="./global.d.ts" />

// eslint-disable-next-line import-x/no-namespace -- Need entire module.
import * as obsidianLib from '@mnaoumov/obsidian-lib';

import { Plugin } from 'obsidian';

/**
 * Minimal plugin that exposes the entire obsidian-lib library for integration testing.
 */
export default class IntegrationTestPlugin extends Plugin {
  public override onload(): void {
    window.__obsidianLibModule = obsidianLib;
  }

  public override onunload(): void {
    delete window.__obsidianLibModule;
  }
}
