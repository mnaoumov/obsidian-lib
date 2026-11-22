/**
 * @file
 *
 * Finds the link at a position in a note's source text (the editor cursor by default), in the note's body
 * and in its YAML frontmatter alike.
 *
 * Every range is inclusive at BOTH ends, so a cursor right before a link (`{cursor}[a](b)`), inside it and
 * right after it (`[a](b){cursor}`) all find it. Obsidian's own `Editor.getClickableTokenAt` misses the
 * first of those and reports nothing at all inside the frontmatter, which is why this exists.
 *
 * Links are found by {@link parseLinks}, one source line at a time, so a link never spans lines here.
 */

import type {
  App,
  Editor,
  EditorPosition,
  TFile
} from 'obsidian';

import { getMandatoryNamedGroup } from '@mnaoumov/typescript-lib/reg-exp';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { parseLinktext } from 'obsidian';

import type {
  ParseLinkResult,
  ParseLinksOptions
} from './parse-link.ts';

import {
  parseLink,
  parseLinks
} from './parse-link.ts';

/**
 * Params for {@link getLinkAtEditorPosition}.
 */
export interface GetLinkAtEditorPositionParams {
  /**
   * The editor to read. Only {@link Editor.getCursor}, {@link Editor.getLine} and {@link Editor.lineCount}
   * are called.
   */
  readonly editor: LinkSourceEditor;

  /**
   * The position to look at. Defaults to the cursor.
   */
  readonly position?: EditorPosition;
}

/**
 * Params for {@link getLinkAtPosition}.
 */
export interface GetLinkAtPositionParams {
  /**
   * The lines of the note's source text.
   */
  readonly lines: LinkSourceLines;

  /**
   * The position to look at.
   */
  readonly position: EditorPosition;
}

/**
 * Params for {@link getLinkAtPositionTarget}.
 */
export interface GetLinkAtPositionTargetParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * The link to resolve.
   */
  readonly link: LinkAtPosition;

  /**
   * The path of the note holding the link.
   */
  readonly sourcePath: string;
}

/**
 * The link found at a position by {@link getLinkAtPosition}.
 */
export interface LinkAtPosition {
  /**
   * The column just past the link's raw text on {@link line}.
   */
  readonly endCh: number;

  /**
   * The dotted path of the block-mapping keys that own the link (`parent.child`), or `null` in the body
   * or when no key owns it. A key inside a flow mapping (`a: { b: "[[x]]" }`) is not part of the path.
   */
  readonly frontmatterKey: null | string;

  /**
   * Whether the link is in the note's frontmatter.
   */
  readonly isInFrontmatter: boolean;

  /**
   * The zero-based line holding the link. It differs from the looked-up line only when the cursor was on a
   * frontmatter key whose single link sits on a following line.
   */
  readonly line: number;

  /**
   * The link path without its subpath: `note` for `[[note#Heading]]`, the whole url for an external link,
   * and an empty string for a link into the same note (`[[#Heading]]`).
   */
  readonly linkPath: string;

  /**
   * The parsed link, its offsets being columns on {@link line}. Its flags tell the kind of link: a wikilink,
   * an embed, an external link.
   */
  readonly parseLinkResult: ParseLinkResult;

  /**
   * The column just past the range a position hits the link in. In the frontmatter the range takes in the
   * quotes around the link, so it can be wider than the link itself.
   */
  readonly rangeEndCh: number;

  /**
   * The first column of the range a position hits the link in.
   */
  readonly rangeStartCh: number;

  /**
   * The column the link's raw text starts at on {@link line}.
   */
  readonly startCh: number;

  /**
   * The subpath with its `#` (`#Heading`, `#^block`), or an empty string.
   */
  readonly subpath: string;
}

/**
 * The part of an {@link Editor} {@link getLinkAtEditorPosition} reads.
 */
export type LinkSourceEditor = LinkSourceLines & Pick<Editor, 'getCursor'>;

/**
 * Lines of a note's source text, the part of an {@link Editor} {@link getLinkAtPosition} reads.
 */
export type LinkSourceLines = Pick<Editor, 'getLine' | 'lineCount'>;

interface FrontmatterLineInfo {
  readonly candidates: readonly LinkCandidate[];
  readonly contentEnd: number;
  readonly key: null | string;
  readonly keyColumn: number;
  readonly valueStart: number;
}

interface LinkCandidate {
  readonly line: number;
  readonly link: ParseLinkResult;
  readonly rangeEnd: number;
  readonly rangeStart: number;
}

interface ParseSegmentParams {
  readonly candidates: LinkCandidate[];
  readonly end: number;
  readonly line: number;
  readonly lineText: string;
  readonly quoteEnd: null | number;
  readonly quoteStart: null | number;
  readonly start: number;
}

interface QuotedSegment {
  readonly end: number;
  readonly innerEnd: number;
  readonly innerStart: number;
  readonly isClosed: boolean;
  readonly start: number;
}

interface ScanValueResult {
  readonly contentEnd: number;
  readonly quotedSegments: readonly QuotedSegment[];
}

interface ToLinkAtPositionParams {
  readonly candidate: LinkCandidate;
  readonly frontmatterKey: null | string;
  readonly isInFrontmatter: boolean;
}

const FRONTMATTER_DELIMITER = '---';
const FRONTMATTER_PARSE_OPTIONS: ParseLinksOptions = { shouldRecognizeWwwAutolinkLiterals: false };
const CODE_FENCE_REG_EXP = /^(?<Fence>`{3,}|~{3,})/;
const ENTRY_GAP_REG_EXP = /^[\s,]*$/;
const FRONTMATTER_KEY_REG_EXP = /^(?<Key>"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"#',:[\]{}][^#:]*?)[\t ]*:(?=[\t ]|$)/;
const SEQUENCE_ITEM_REG_EXP = /^-(?=[\t ]|$)[\t ]*/;
const LEADING_WHITESPACE_REG_EXP = /^[\t ]+/;

/**
 * Finds the link at an editor position, the cursor by default. See {@link getLinkAtPosition} for the rules.
 *
 * @param params - The editor and the position.
 * @returns The link, or `null` when the position is not on one.
 */
export function getLinkAtEditorPosition(params: GetLinkAtEditorPositionParams): LinkAtPosition | null {
  const { editor } = params;
  return getLinkAtPosition({ lines: editor, position: params.position ?? editor.getCursor() });
}

/**
 * Finds the link at a position in a note's source text.
 *
 * In the body:
 *
 * 1. A link is hit from the column of its first character to the column just past its last, both included.
 * 2. When two links touch (`[a](x){cursor}[b](y)`), the one the cursor is before wins.
 * 3. A line inside a fenced code block, or a fence line itself, holds no link. Indentation is ignored, so a
 *    nested list item is not read as an indented code block.
 *
 * In the frontmatter:
 *
 * 1. The quotes belong to the link: `key: {cursor}"[[note]]"` and `key: "[[note]]"{cursor}` both hit. So do
 *    unquoted values, flow sequences, block sequence items and Markdown links.
 * 2. A position on the key, the sequence dash, the indentation or the gap before the value hits only when
 *    the value holds exactly one link, as `{cursor}key: "[[note]]"` does. A key with an empty value counts
 *    the links on its nested lines. Several links give `null`, since nothing says which one is meant.
 * 3. The commas and spaces between two entries (`["[[a]]",{cursor} "[[b]]"]`) hit the entry after them.
 * 4. Nothing in a comment is a link, and the delimiter lines hold none.
 *
 * Positions are those of the YAML source text. The Properties view is a widget, not editor text, so it has
 * no positions to look up.
 *
 * @param params - The lines and the position.
 * @returns The link, or `null` when the position is not on one.
 */
export function getLinkAtPosition(params: GetLinkAtPositionParams): LinkAtPosition | null {
  const { lines, position } = params;
  if (position.line < 0 || position.line >= lines.lineCount()) {
    return null;
  }

  const frontmatterEndLine = getFrontmatterEndLine(lines);
  if (frontmatterEndLine !== null && position.line <= frontmatterEndLine) {
    return position.line === 0 || position.line === frontmatterEndLine ? null : getFrontmatterLink(lines, position, frontmatterEndLine);
  }

  const bodyStartLine = frontmatterEndLine === null ? 0 : frontmatterEndLine + 1;
  if (isInCodeFence(lines, bodyStartLine, position.line)) {
    return null;
  }

  const candidate = pickCandidate(getBodyCandidates(lines.getLine(position.line), position.line), position.ch);
  return candidate ? toLinkAtPosition({ candidate, frontmatterKey: null, isInFrontmatter: false }) : null;
}

/**
 * Resolves the note a link found by {@link getLinkAtPosition} points at, through
 * `metadataCache.getFirstLinkpathDest`. A link into the same note (`[[#Heading]]`) resolves to that note.
 *
 * @param params - The app, the link and the path of the note holding it.
 * @returns The target file, or `null` for an external link or an unresolved one.
 */
export function getLinkAtPositionTarget(params: GetLinkAtPositionTargetParams): null | TFile {
  const { app, link, sourcePath } = params;
  if (link.parseLinkResult.isExternal) {
    return null;
  }

  if (link.linkPath === '') {
    return app.vault.getFileByPath(sourcePath);
  }

  return app.metadataCache.getFirstLinkpathDest(link.linkPath, sourcePath);
}

function analyzeFrontmatterLine(lineText: string, line: number): FrontmatterLineInfo {
  let column = getLeadingWhitespaceLength(lineText);
  for (;;) {
    const sequenceItemMatch = SEQUENCE_ITEM_REG_EXP.exec(lineText.slice(column));
    if (!sequenceItemMatch) {
      break;
    }
    column += sequenceItemMatch[0].length;
  }

  const keyColumn = column;
  const keyMatch = FRONTMATTER_KEY_REG_EXP.exec(lineText.slice(column));
  let key: null | string = null;
  if (keyMatch) {
    key = unquoteKey(getMandatoryNamedGroup(keyMatch, 'Key'));
    column += keyMatch[0].length;
    column += getLeadingWhitespaceLength(lineText.slice(column));
  }

  const valueStart = column;
  const { contentEnd, quotedSegments } = scanValue(lineText, valueStart);
  const candidates: LinkCandidate[] = [];
  let plainStart = valueStart;
  for (const segment of quotedSegments) {
    parseSegment({ candidates, end: segment.start, line, lineText, quoteEnd: null, quoteStart: null, start: plainStart });
    parseSegment({
      candidates,
      end: segment.innerEnd,
      line,
      lineText,
      quoteEnd: segment.isClosed ? segment.end : null,
      quoteStart: segment.isClosed ? segment.start : null,
      start: segment.innerStart
    });
    plainStart = segment.end;
  }
  parseSegment({ candidates, end: contentEnd, line, lineText, quoteEnd: null, quoteStart: null, start: plainStart });

  return {
    candidates,
    contentEnd,
    key,
    keyColumn,
    valueStart
  };
}

function collectNestedCandidates(lines: LinkSourceLines, keyLine: number, keyColumn: number, frontmatterEndLine: number): LinkCandidate[] {
  const candidates: LinkCandidate[] = [];
  for (let line = keyLine + 1; line < frontmatterEndLine; line++) {
    const lineText = lines.getLine(line);
    if (lineText.trim() === '') {
      continue;
    }

    const indent = getLeadingWhitespaceLength(lineText);
    const isSameIndentSequenceItem = indent === keyColumn && SEQUENCE_ITEM_REG_EXP.test(lineText.slice(indent));
    if (indent <= keyColumn && !isSameIndentSequenceItem) {
      break;
    }

    candidates.push(...analyzeFrontmatterLine(lineText, line).candidates);
  }
  return candidates;
}

function findClosingQuote(lineText: string, openingIndex: number): number {
  const quote = lineText.charAt(openingIndex);
  for (let index = openingIndex + 1; index < lineText.length; index++) {
    const character = lineText.charAt(index);
    if (quote === '"' && character === '\\') {
      index++;
      continue;
    }

    if (character !== quote) {
      continue;
    }

    // A single-quoted scalar escapes a quote by doubling it.
    if (quote === '\'' && lineText.charAt(index + 1) === '\'') {
      index++;
      continue;
    }

    return index;
  }

  return -1;
}

function findFrontmatterKey(lines: LinkSourceLines, line: number, lineInfo: FrontmatterLineInfo): null | string {
  const keys: string[] = [];
  let column = lineInfo.keyColumn;
  if (lineInfo.key !== null) {
    keys.push(lineInfo.key);
  }

  for (let previousLine = line - 1; previousLine > 0 && column > 0; previousLine--) {
    const previousText = lines.getLine(previousLine);
    if (previousText.trim() === '') {
      continue;
    }

    const previousInfo = analyzeFrontmatterLine(previousText, previousLine);
    if (previousInfo.key === null || previousInfo.keyColumn >= column) {
      continue;
    }

    // A key owns the lines below it only while its own value is empty.
    if (previousInfo.valueStart < previousInfo.contentEnd && previousText.slice(previousInfo.valueStart, previousInfo.contentEnd).trim() !== '') {
      continue;
    }

    keys.unshift(previousInfo.key);
    column = previousInfo.keyColumn;
  }

  return keys.length === 0 ? null : keys.join('.');
}

function getBodyCandidates(lineText: string, line: number): LinkCandidate[] {
  const indent = getLeadingWhitespaceLength(lineText);
  return parseLinks(lineText.slice(indent)).map((link) => {
    const shiftedLink = shiftLink(link, indent);
    return { line, link: shiftedLink, rangeEnd: shiftedLink.endOffset, rangeStart: shiftedLink.startOffset };
  });
}

function getCodeFence(lineText: string): null | string {
  const match = CODE_FENCE_REG_EXP.exec(lineText.trimStart());
  return match ? getMandatoryNamedGroup(match, 'Fence') : null;
}

function getFrontmatterEndLine(lines: LinkSourceLines): null | number {
  const lineCount = lines.lineCount();
  if (lines.getLine(0).trimEnd() !== FRONTMATTER_DELIMITER) {
    return null;
  }

  for (let line = 1; line < lineCount; line++) {
    if (lines.getLine(line).trimEnd() === FRONTMATTER_DELIMITER) {
      return line;
    }
  }

  return null;
}

function getFrontmatterLink(lines: LinkSourceLines, position: EditorPosition, frontmatterEndLine: number): LinkAtPosition | null {
  const lineInfo = analyzeFrontmatterLine(lines.getLine(position.line), position.line);
  const { candidates } = lineInfo;
  let candidate = pickCandidate(candidates, position.ch);

  if (!candidate && position.ch >= lineInfo.valueStart) {
    // The candidates are in line order, so the one before the next is the previous.
    const nextIndex = candidates.findIndex((nextCandidate) => nextCandidate.rangeStart > position.ch);
    const next = candidates[nextIndex];
    // Without a next candidate the index is -1, and both reads are out of range.
    const previous = candidates[nextIndex - 1];
    if (next && previous && ENTRY_GAP_REG_EXP.test(lines.getLine(position.line).slice(previous.rangeEnd, next.rangeStart))) {
      candidate = next;
    }
  }

  if (!candidate && position.ch < lineInfo.valueStart) {
    const hasEmptyValue = lineInfo.key !== null && candidates.length === 0
      && lines.getLine(position.line).slice(lineInfo.valueStart, lineInfo.contentEnd).trim() === '';
    const valueCandidates = hasEmptyValue
      ? collectNestedCandidates(lines, position.line, lineInfo.keyColumn, frontmatterEndLine)
      : candidates;
    if (valueCandidates.length === 1) {
      candidate = ensureNonNullable(valueCandidates[0]);
    }
  }

  if (!candidate) {
    return null;
  }

  const candidateLineInfo = candidate.line === position.line ? lineInfo : analyzeFrontmatterLine(lines.getLine(candidate.line), candidate.line);
  return toLinkAtPosition({
    candidate,
    frontmatterKey: findFrontmatterKey(lines, candidate.line, candidateLineInfo),
    isInFrontmatter: true
  });
}

function getLeadingWhitespaceLength(text: string): number {
  return text.length - text.replace(LEADING_WHITESPACE_REG_EXP, '').length;
}
function isInCodeFence(lines: LinkSourceLines, startLine: number, line: number): boolean {
  let openFence: null | string = null;
  for (let currentLine = startLine; currentLine < line; currentLine++) {
    const fence = getCodeFence(lines.getLine(currentLine));
    if (fence === null) {
      continue;
    }

    if (openFence === null) {
      openFence = fence;
    } else if (fence.startsWith(openFence.charAt(0)) && fence.length >= openFence.length) {
      openFence = null;
    }
  }

  return openFence !== null || getCodeFence(lines.getLine(line)) !== null;
}

function parseSegment(params: ParseSegmentParams): void {
  const { candidates, end, line, lineText, quoteEnd, quoteStart, start } = params;
  const text = lineText.slice(start, end);
  const trimmedText = text.trim();
  if (trimmedText === '') {
    return;
  }

  const trimOffset = start + text.indexOf(trimmedText);
  const wholeLink = parseLink(trimmedText, FRONTMATTER_PARSE_OPTIONS);
  if (wholeLink) {
    const link = shiftLink(wholeLink, trimOffset);
    const isWholeSegment = trimmedText === text;
    candidates.push({
      line,
      link,
      rangeEnd: isWholeSegment && quoteEnd !== null ? quoteEnd : link.endOffset,
      rangeStart: isWholeSegment && quoteStart !== null ? quoteStart : link.startOffset
    });
    return;
  }

  for (const parsedLink of parseLinks(trimmedText, FRONTMATTER_PARSE_OPTIONS)) {
    const link = shiftLink(parsedLink, trimOffset);
    candidates.push({ line, link, rangeEnd: link.endOffset, rangeStart: link.startOffset });
  }
}

function pickCandidate(candidates: readonly LinkCandidate[], ch: number): LinkCandidate | null {
  return candidates.find((candidate) => candidate.rangeStart <= ch && ch < candidate.rangeEnd)
    ?? candidates.find((candidate) => candidate.rangeEnd === ch)
    ?? null;
}

/**
 * Scans a frontmatter value for its quoted scalars and the comment that ends it.
 *
 * @param lineText - The line.
 * @param valueStart - The column the value starts at.
 * @returns The column the comment starts at (or the line's length) and the quoted scalars before it.
 */
function scanValue(lineText: string, valueStart: number): ScanValueResult {
  const quotedSegments: QuotedSegment[] = [];
  let index = valueStart;
  while (index < lineText.length) {
    const character = lineText.charAt(index);
    if (character === '#' && (index === valueStart || /\s/.test(lineText.charAt(index - 1)))) {
      return { contentEnd: index, quotedSegments };
    }

    if (character !== '"' && character !== '\'') {
      index++;
      continue;
    }

    const closingIndex = findClosingQuote(lineText, index);
    const isClosed = closingIndex !== -1;
    const innerEnd = isClosed ? closingIndex : lineText.length;
    const end = isClosed ? closingIndex + 1 : lineText.length;
    quotedSegments.push({ end, innerEnd, innerStart: index + 1, isClosed, start: index });
    index = end;
  }

  return { contentEnd: lineText.length, quotedSegments };
}

function shiftLink(link: ParseLinkResult, offset: number): ParseLinkResult {
  return offset === 0
    ? link
    : { ...link, endOffset: link.endOffset + offset, startOffset: link.startOffset + offset };
}

function toLinkAtPosition(params: ToLinkAtPositionParams): LinkAtPosition {
  const { candidate, frontmatterKey, isInFrontmatter } = params;
  const { link } = candidate;
  const { path, subpath } = link.isExternal ? { path: link.url, subpath: '' } : parseLinktext(link.url);
  return {
    endCh: link.endOffset,
    frontmatterKey,
    isInFrontmatter,
    line: candidate.line,
    linkPath: path,
    parseLinkResult: link,
    rangeEndCh: candidate.rangeEnd,
    rangeStartCh: candidate.rangeStart,
    startCh: link.startOffset,
    subpath
  };
}

function unquoteKey(key: string): string {
  if (key.startsWith('"') && key.endsWith('"')) {
    return key.slice(1, -1).replaceAll(String.raw`\"`, '"');
  }

  if (key.startsWith('\'') && key.endsWith('\'')) {
    return key.slice(1, -1).replaceAll('\'\'', '\'');
  }

  return key;
}
