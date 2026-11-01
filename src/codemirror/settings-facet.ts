/**
 * @file
 *
 * Creates a CodeMirror {@link Facet} that carries a plugin's settings into its editor extensions.
 *
 * An extension reads the settings with `state.facet(settingsFacet)` instead of closing over a settings object, so a
 * change reaches every editor as an ordinary reconfigure: `SettingsFacetComponent` swaps `settingsFacet.of(settings)`
 * in a compartment, and every view plugin and state field sees the new value in the same update.
 */

import { Facet } from '@codemirror/state';

/**
 * Creates a facet whose value is the last settings value provided, or the default when none is.
 *
 * @typeParam T - The settings type.
 * @param defaultValue - The value an editor reads when no settings are provided.
 * @returns The settings facet.
 */
export function createSettingsFacet<T>(defaultValue: T): Facet<T, T> {
  return Facet.define<T, T>({
    combine(values) {
      return values.length === 0 ? defaultValue : values.at(-1) as T;
    }
  });
}
