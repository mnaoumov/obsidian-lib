/**
 * @file
 *
 * This file defines the `i18n` module for `i18next`.
 */

import type {
  SelectorFn,
  SelectorOptions,
  TFunction
} from 'i18next';
import type { ReadonlyDeep } from 'type-fest';

import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import {
  ensureGenericObject,
  isObject
} from '@mnaoumov/typescript-lib/type-guards';
import i18next, {
  init,
  t as tLib
} from 'i18next';
import { getLanguage } from 'obsidian';

import type { DefaultTranslationsBase } from './default-translations.ts';

import { getObsidianLibDebugger } from '../debug.ts';
import { en } from './locales/en.ts';
import {
  DEFAULT_LANGUAGE,
  defaultTranslationsMap
} from './locales/translations-map.ts';

/**
 * The default namespace.
 */
export const DEFAULT_NS = 'translation';

/**
 * Loads the translations of one language on demand.
 *
 * {@link initI18N} calls a loader only when its language can be shown: Obsidian's current language, that language's
 * base language (`pt` for `pt-BR`), or the default language. A plugin bundles every locale into its one `main.js`,
 * so a loader saves startup work, not download bytes. The usual loader is
 * `async () => (await import('./locales/de.ts')).de`, which esbuild bundles inline as a module that is initialized
 * only when the loader runs. See {@link https://mnaoumov.dev/obsidian-lib/guides/translations/}.
 */
export type LocaleLoader = () => Promise<Translations> | Translations;

/**
 * The translations of one language, in the shape of the default (English) translations.
 */
export type Translations = Record<string, unknown>;

/**
 * The translations map: each language maps to its translations, or to a {@link LocaleLoader} for them.
 */
export type TranslationsMap = Record<string, LocaleLoader | Translations>;

interface TOptions extends SelectorOptions<[typeof DEFAULT_NS]> {
  readonly ns: [typeof DEFAULT_NS];
}

/**
 * Gets the languages whose {@link LocaleLoader} {@link initI18N} calls for a given Obsidian language: the language
 * itself, its base language when it has a region or script part, and the default language.
 *
 * @param language - The Obsidian language, as `getLanguage()` returns it.
 * @returns The languages to load, without duplicates.
 */
export function getLanguagesToLoad(language: string): string[] {
  const baseLanguage = language.replace(/-.*$/u, '');
  return [...new Set([baseLanguage, DEFAULT_LANGUAGE, language])];
}

/**
 * Initializes the `i18n` module.
 *
 * Calling this again re-runs `i18next.init()`, which fully replaces the resource store and language, so a reload picks
 * up a changed language or translations map. The lazy fallback in {@link t} and external callers rely on
 * `i18next.isInitialized` (set by `i18next.init()`) as the single source of truth, so no separate guard is kept here.
 *
 * A {@link LocaleLoader} entry is called only for a language that can be shown (see {@link getLanguagesToLoad}), and
 * the loaders run one after another, before `i18next.init()`. A loader that throws, rejects or returns something
 * other than an object is reported with `console.error` and skipped, so that language falls back to the default
 * language rather than failing the plugin's load. A language with no entry falls back the same way.
 *
 * @param translationsMap - The translations map.
 * @param isAsync - Whether the initialization is asynchronous.
 * @returns A {@link Promise} that resolves when the `i18n` module is initialized.
 */
export async function initI18N(translationsMap: TranslationsMap, isAsync = true): Promise<void> {
  const language = getLanguage();
  const languagesToLoad = getLanguagesToLoad(language);
  const resources: Record<string, Record<typeof DEFAULT_NS, Translations>> = {};

  for (const [entryLanguage, entry] of Object.entries(translationsMap)) {
    if (typeof entry !== 'function') {
      resources[entryLanguage] = { [DEFAULT_NS]: entry };
      continue;
    }

    if (!languagesToLoad.includes(entryLanguage)) {
      continue;
    }

    const translations = await loadLocale(entryLanguage, entry);
    if (translations) {
      resources[entryLanguage] = { [DEFAULT_NS]: translations };
    }
  }

  await init({
    fallbackLng: DEFAULT_LANGUAGE,
    initAsync: isAsync,
    interpolation: {
      escapeValue: false
    },
    lng: language,
    resources,
    returnEmptyString: false,
    returnNull: false
  });

  i18next.addResourceBundle(DEFAULT_LANGUAGE, DEFAULT_NS, en, true, false);
}

async function loadLocale(language: string, loader: LocaleLoader): Promise<null | Translations> {
  try {
    const translations: unknown = await loader();
    if (isObject(translations) && !Array.isArray(translations)) {
      return ensureGenericObject(translations);
    }

    console.error(`The translations loader for the language '${language}' returned no translations object`, { translations });
  } catch (error) {
    console.error(`The translations loader for the language '${language}' failed`, error);
  }

  return null;
}

function tImpl(
  selector: SelectorFn<ReadonlyDeep<DefaultTranslationsBase>, string, SelectorOptions<[typeof DEFAULT_NS]>>,
  options?: TOptions
): string {
  if (!i18next.isInitialized) {
    getObsidianLibDebugger('I18N:t')('I18N was not initialized, initializing default obsidian-lib translations');
    invokeAsyncSafely(() => initI18N(defaultTranslationsMap, false));
  }

  return options ? tLib(selector, options) : tLib(selector);
}

/**
 * The `t` function.
 *
 * If {@link initI18N} has not been called yet — which is the case for a plugin that extends Obsidian's raw `Plugin`
 * instead of `PluginBase`, since `PluginBase.onload` is the only caller of {@link initI18N} — the first call lazily
 * initializes the library's default translations and still returns the correct string. That fallback is a
 * supported path, so it is reported through the `obsidian-lib:I18N:t` debug namespace rather than the console:
 * it stays silent unless debug messages are enabled. See
 * {@link https://mnaoumov.dev/obsidian-lib/guides/debugging/}.
 */
export const t = tImpl as TFunction;
