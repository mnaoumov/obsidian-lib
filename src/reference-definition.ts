/**
 * @file
 *
 * Edits the destination of a reference-style link definition (`[id]: destination "title"`) that Obsidian reports
 * in `CachedMetadata.referenceLinks`.
 *
 * Read from Obsidian `1.15.1`: a definition's `position` spans the whole definition, its leading indentation
 * included and any blockquote or list marker excluded, and its `link` is the destination with the angle brackets
 * removed and every backslash escape resolved (`Target\#Escaped.md` reports `Target#Escaped.md`). The uses of a
 * definition (`[text][id]`, `[id][]`, `[id]`) are not reported in `links` and name the definition by its id, so
 * rewriting only the destination keeps every one of them pointing at the new target.
 */

import type {
  Loc,
  ReferenceCache,
  ReferenceLinkCache
} from 'obsidian';

import type { FileChange } from './file-change.ts';

import { getObsidianLibDebugger } from './debug.ts';

/**
 * Parameters for {@link referenceDefinitionToFileChange}.
 */
export interface ReferenceDefinitionToFileChangeParams {
  /**
   * The content the definition's position refers to.
   */
  readonly content: string;

  /**
   * The definition, as Obsidian reports it in `CachedMetadata.referenceLinks`.
   */
  readonly definition: ReferenceLinkCache;

  /**
   * The new destination, unescaped, in the same form as {@link ReferenceLinkCache.link}.
   */
  readonly newDestination: string;
}

interface DestinationToken {
  readonly end: number;
  readonly isAngle: boolean;
  readonly raw: string;
  readonly start: number;
}

const ASCII_PUNCTUATION_REG_EXP = /[!-/:-@[-`{-~]/;
const BARE_DESTINATION_FORBIDDEN_CHARACTER_REG_EXP = /[\s\p{Cc}]/u;
const DEFINITION_PREFIX_REG_EXP = /^[ \t]*\[(?:\\[\s\S]|[^\\\]])+\]:[ \t]*(?:\r?\n(?:[ \t]*>)*[ \t]*)?/;
const LINE_BREAK_REG_EXP = /[\r\n]/;
const WHITESPACE_REG_EXP = /\s/;

/**
 * Builds the file change that replaces the destination of a reference-style link definition, leaving its id, its
 * title and the rest of the note unchanged.
 *
 * The destination keeps its form: one written in angle brackets stays in them, and a bare one stays bare unless
 * the new destination cannot be written bare (it is empty, holds whitespace or a control character, starts with
 * `<`, or has unbalanced parentheses), in which case it is written in angle brackets. Characters that would end
 * or change the destination are escaped with a backslash.
 *
 * @param params - The parameters for building the file change.
 * @returns The file change, or `null` when the content at the definition's position no longer holds a definition
 * whose destination reads as {@link ReferenceLinkCache.link}, or when the new destination holds a line break,
 * which no destination can.
 */
export function referenceDefinitionToFileChange(params: ReferenceDefinitionToFileChangeParams): FileChange | null {
  const { content, definition, newDestination } = params;
  const referenceDefinitionDebugger = getObsidianLibDebugger('ReferenceDefinition:referenceDefinitionToFileChange');

  const token = findDestinationToken(content, definition);
  if (!token) {
    referenceDefinitionDebugger('Skipping a definition whose content does not match its metadata', { definition });
    return null;
  }

  const newRaw = encodeDestination(newDestination, token.isAngle);
  if (newRaw === null) {
    referenceDefinitionDebugger('Skipping a destination that holds a line break', { definition, newDestination });
    return null;
  }

  const reference: ReferenceCache = {
    link: definition.link,
    original: token.raw,
    position: {
      end: getLoc(content, definition, token.end),
      start: getLoc(content, definition, token.start)
    }
  };

  return {
    newContent: newRaw,
    oldContent: token.raw,
    reference
  };
}

function canBeBare(destination: string): boolean {
  if (destination === '' || destination.startsWith('<') || BARE_DESTINATION_FORBIDDEN_CHARACTER_REG_EXP.test(destination)) {
    return false;
  }

  let depth = 0;
  for (const character of destination) {
    if (character === '(') {
      depth++;
    } else if (character === ')') {
      depth--;
      if (depth < 0) {
        return false;
      }
    }
  }

  return depth === 0;
}

function encodeDestination(destination: string, isAngle: boolean): null | string {
  if (LINE_BREAK_REG_EXP.test(destination)) {
    return null;
  }

  const shouldUseAngle = isAngle || !canBeBare(destination);
  let encoded = '';
  for (let index = 0; index < destination.length; index++) {
    const character = destination.charAt(index);
    const nextCharacter = destination.charAt(index + 1);
    const isEscapeNeeded = shouldUseAngle
      ? character === '<' || character === '>' || (character === '\\' && (nextCharacter === '' || ASCII_PUNCTUATION_REG_EXP.test(nextCharacter)))
      : character === '\\' && ASCII_PUNCTUATION_REG_EXP.test(nextCharacter);
    encoded += isEscapeNeeded ? `\\${character}` : character;
  }

  return shouldUseAngle ? `<${encoded}>` : encoded;
}

function findDestinationToken(content: string, definition: ReferenceLinkCache): DestinationToken | null {
  const definitionStart = definition.position.start.offset;
  const definitionEnd = definition.position.end.offset;
  if (definitionStart < 0 || definitionEnd > content.length || definitionEnd < definitionStart) {
    return null;
  }

  const definitionText = content.slice(definitionStart, definitionEnd);
  const prefix = DEFINITION_PREFIX_REG_EXP.exec(definitionText);
  if (!prefix) {
    return null;
  }

  const tokenStart = prefix[0].length;
  const isAngle = definitionText.charAt(tokenStart) === '<';
  let tokenEnd = isAngle ? tokenStart + 1 : tokenStart;
  for (; tokenEnd < definitionText.length; tokenEnd++) {
    const character = definitionText.charAt(tokenEnd);
    if (isAngle ? character === '>' || LINE_BREAK_REG_EXP.test(character) : WHITESPACE_REG_EXP.test(character)) {
      break;
    }
    if (character === '\\' && ASCII_PUNCTUATION_REG_EXP.test(definitionText.charAt(tokenEnd + 1))) {
      tokenEnd++;
    }
  }

  if (isAngle) {
    if (definitionText.charAt(tokenEnd) !== '>') {
      return null;
    }
    tokenEnd++;
  }

  const boundary = definitionText.charAt(tokenEnd);
  if (boundary !== '' && !WHITESPACE_REG_EXP.test(boundary)) {
    return null;
  }

  const raw = definitionText.slice(tokenStart, tokenEnd);
  const value = isAngle ? raw.slice(1, -1) : raw;
  if (tokenEnd === tokenStart || unescapeDestination(value) !== definition.link) {
    return null;
  }

  return {
    end: definitionStart + tokenEnd,
    isAngle,
    raw,
    start: definitionStart + tokenStart
  };
}

function getLoc(content: string, definition: ReferenceLinkCache, offset: number): Loc {
  const definitionStart = definition.position.start.offset;
  let line = definition.position.start.line;
  for (let index = definitionStart; index < offset; index++) {
    if (content.charAt(index) === '\n') {
      line++;
    }
  }

  return {
    col: offset - (content.lastIndexOf('\n', offset - 1) + 1),
    line,
    offset
  };
}

function unescapeDestination(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index++) {
    const character = value.charAt(index);
    const nextCharacter = value.charAt(index + 1);
    if (character === '\\' && ASCII_PUNCTUATION_REG_EXP.test(nextCharacter)) {
      result += nextCharacter;
      index++;
    } else {
      result += character;
    }
  }

  return result;
}
