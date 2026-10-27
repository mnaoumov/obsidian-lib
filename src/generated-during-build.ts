/**
 * @file
 *
 * Values substituted into the built library during release.
 *
 * The `$(...)` placeholders below are inert source text; the build step `build:stamp-generated`
 * (`scripts/build/stamp-generated-during-build.ts`) rewrites them in the compiled
 * `generated-during-build.{cjs,mjs}` output with the real library version and bundled styles. They carry
 * no Obsidian import or API, so this module stays Obsidian-runtime-agnostic.
 *
 * Both are widened to `string` on purpose (`as string`, since a type annotation is flagged as inferrable).
 * Left as literals, each would be declared as its placeholder, and the
 * emitted `.d.cts` / `.d.mts` would tell a consumer that `LIBRARY_VERSION` is `"$(LIBRARY_VERSION)"`
 * while its runtime value is the stamped version. The stamp step refuses a declaration that still names
 * a placeholder.
 */

/**
 * The version of the `@mnaoumov/obsidian-lib` library.
 */
export const LIBRARY_VERSION = '$(LIBRARY_VERSION)' as string;

/**
 * The styles of the `@mnaoumov/obsidian-lib` library.
 */
export const LIBRARY_STYLES = '$(LIBRARY_STYLES)' as string;
