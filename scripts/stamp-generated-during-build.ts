/**
 * @file
 *
 * Stamps the release-time values into the built `generated-during-build.{cjs,mjs}`.
 *
 * `src/generated-during-build.ts` declares `$(...)` placeholders that carry no value of their own, so
 * something has to rewrite them in the compiled output with the real library version and bundled styles.
 * This runs as a build step rather than as part of the release, because the published tarball is built by
 * `.github/workflows/publish-npm.yml` on a fresh checkout — a release-time rewrite reaches the maintainer's
 * `dist/` and nothing else, which is how `94.7.0` through `96.0.0` came to ship the placeholders literally.
 *
 * The `.d.cts` / `.d.mts` beside them are checked rather than stamped: they must declare `string`, not a
 * placeholder literal.
 */

import { readPackageJson } from '@mnaoumov/typescript-dev-toolkit/npm';
import { RepoPaths } from '@mnaoumov/typescript-dev-toolkit/repo-paths';
import { resolvePathFromRootSafe } from '@mnaoumov/typescript-dev-toolkit/root';
import { join } from '@mnaoumov/typescript-lib/path';
import {
  readFile,
  writeFile
} from 'node:fs/promises';

import { LocalRepoPaths } from './helpers/local-repo-paths.ts';

/**
 * Rewrites the placeholders in the built `generated-during-build.{cjs,mjs}` with the version from
 * `package.json` and the contents of the built stylesheet.
 *
 * Runs after `build:styles` (which produces the stylesheet it reads) and before the steps that bundle the
 * library, so the bundles inherit the stamped values instead of the placeholders.
 *
 * @returns A {@link Promise} that resolves when both files have been stamped and both declarations checked.
 */
export async function stampGeneratedDuringBuild(): Promise<void> {
  const packageJson = await readPackageJson();
  const version = packageJson.version;
  if (!version) {
    throw new Error('`package.json` declares no version to stamp into the built library.');
  }

  const stylesCssPath = resolvePathFromRootSafe({ path: join(RepoPaths.Dist, RepoPaths.StylesCss) });
  const styles = await readFile(stylesCssPath, 'utf-8');

  const generatedPaths = [
    resolvePathFromRootSafe({ path: join(RepoPaths.DistLib, RepoPaths.Cjs, LocalRepoPaths.GeneratedDuringBuildCjs) }),
    resolvePathFromRootSafe({ path: join(RepoPaths.DistLib, RepoPaths.Esm, LocalRepoPaths.GeneratedDuringBuildMjs) })
  ];

  for (const generatedPath of generatedPaths) {
    let content = await readFile(generatedPath, 'utf-8');
    content = stampConstant(content, generatedPath, 'LIBRARY_VERSION', version);
    content = stampConstant(content, generatedPath, 'LIBRARY_STYLES', styles);
    await writeFile(generatedPath, content, 'utf-8');
  }

  const declarationPaths = [
    resolvePathFromRootSafe({ path: join(RepoPaths.DistLib, RepoPaths.Cjs, LocalRepoPaths.GeneratedDuringBuildDCts) }),
    resolvePathFromRootSafe({ path: join(RepoPaths.DistLib, RepoPaths.Esm, LocalRepoPaths.GeneratedDuringBuildDMts) })
  ];

  for (const declarationPath of declarationPaths) {
    const content = await readFile(declarationPath, 'utf-8');
    assertNoPlaceholderDeclaration(content, declarationPath, 'LIBRARY_VERSION');
    assertNoPlaceholderDeclaration(content, declarationPath, 'LIBRARY_STYLES');
  }
}

/**
 * Throws if a declaration file still types a constant as its `$(...)` placeholder.
 *
 * The declarations are not stamped. The source widens both constants to `string`, so they never name a value.
 * A literal type would declare the placeholder instead, and a consumer would see that type while
 * the runtime value is the stamped one, which is what `1.0.0` shipped.
 *
 * @param content - The declaration file's contents.
 * @param path - The file the contents came from, named in the error.
 * @param name - The name of the constant to check.
 */
function assertNoPlaceholderDeclaration(content: string, path: string, name: string): void {
  // The statement is matched, not the bare placeholder, because the file's own doc comment may quote it.
  const placeholder = `$(${name})`;
  if (content.includes(`declare const ${name} = ${JSON.stringify(placeholder)};`)) {
    throw new Error(
      `'${path}' still declares the \`${name}\` placeholder. Widen the constant to \`string\` in \`src/generated-during-build.ts\`, or consumers will see the placeholder as its type.`
    );
  }
}

/**
 * Replaces the value of a top-level `const` string declaration in compiled output.
 *
 * @param content - The compiled file's contents.
 * @param path - The file the contents came from, named in the error if the declaration is missing.
 * @param name - The name of the declaration to stamp.
 * @param value - The value to stamp into it.
 * @returns The contents with the declaration rewritten.
 */
function stampConstant(content: string, path: string, name: string, value: string): string {
  // The whole statement is matched, not just the placeholder, which makes this idempotent.
  // Re-stamping an already-stamped file replaces the previous value instead of matching nothing.
  // That matters because `scripts/version.ts` re-stamps a `dist/` the build has already stamped.
  const pattern = new RegExp(String.raw`^const ${name} = (?:"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*');$`, 'm');
  if (!pattern.test(content)) {
    throw new Error(`Could not find the \`${name}\` declaration to stamp in '${path}'. The published library would carry the placeholder instead of a value.`);
  }

  // The replacement goes through a function so the inserted text is taken literally.
  // As a plain string, a `$&` or `$'` in the stylesheet would be expanded by `String#replace`.
  // Ordinary CSS does contain `$'`, for example in a `[href$='...']` selector.
  return content.replace(pattern, () => `const ${name} = ${JSON.stringify(value)};`);
}
