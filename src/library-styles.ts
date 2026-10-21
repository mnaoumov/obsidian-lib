/**
 * @file
 *
 * Injects the library's stylesheet once per renderer, letting the newest loaded copy win.
 *
 * Every plugin bundles its own copy, so several copies can share one renderer, and only one of them should own the
 * `<style>` element. Each copy records the version that injected the styles in the shared state, and a copy injects
 * only when it is newer than that record.
 */

import { compareVersions } from 'compare-versions';

import { OBSIDIAN_LIBRARY_NAME } from './library.ts';
import { getObsidianLibState } from './obsidian-lib-state.ts';

/**
 * The id of the `<style>` element holding the library styles, so whichever copy injects last replaces the element
 * instead of adding a second one.
 */
export const LIBRARY_STYLES_ELEMENT_ID = `${OBSIDIAN_LIBRARY_NAME}-styles`;

/**
 * The shared-state key under which copies record the version that injected the styles.
 */
export const LAST_LIBRARY_VERSION_KEY = 'lastLibraryVersion';

/**
 * Params for {@link injectLibraryStyles}.
 */
export interface InjectLibraryStylesParams {
  /**
   * The document whose `<head>` receives the `<style>` element.
   */
  readonly doc: Document;

  /**
   * The CSS to inject.
   */
  readonly libraryStyles: string;

  /**
   * The version of this copy.
   */
  readonly libraryVersion: string;
}

/**
 * Injects the library styles, unless a copy of the same or a newer version already did.
 *
 * @param params - The {@link InjectLibraryStylesParams}.
 */
export function injectLibraryStyles(params: InjectLibraryStylesParams): void {
  const { doc, libraryStyles, libraryVersion } = params;

  const lastVersionWrapper = getObsidianLibState<null | string>(LAST_LIBRARY_VERSION_KEY, null);
  if (lastVersionWrapper.value !== null && compareVersions(libraryVersion, lastVersionWrapper.value) <= 0) {
    return;
  }

  lastVersionWrapper.value = libraryVersion;

  doc.head.querySelector(`#${LIBRARY_STYLES_ELEMENT_ID}`)?.remove();
  // eslint-disable-next-line obsidianmd/no-forbidden-elements -- We need to create a style element to apply the library styles.
  doc.head.createEl('style', {
    attr: {
      id: LIBRARY_STYLES_ELEMENT_ID
    },
    text: libraryStyles
  });
}
