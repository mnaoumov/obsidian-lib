/**
 * @file
 *
 * This module provides a helper type for the information about a code block in a markdown file.
 */

/* v8 ignore start -- Interface-only module; no runtime code to test. */

import type {
  MarkdownSectionInformation,
  Pos
} from 'obsidian';

/**
 * Information about a code block in a markdown file.
 */
export interface CodeBlockMarkdownInformation {
  /**
   * Arguments of the code block.
   */
  readonly $arguments: string[];

  /**
   * An end delimiter of the code block.
   */
  readonly endDelimiter: string;

  /**
   * A language of the code block.
   */
  readonly language: string;

  /**
   * A line prefix of each line of the code block.
   */
  readonly linePrefix: string;

  /**
   * A content of the note.
   */
  readonly noteContent: string;

  /**
   * A position of the code block in the note.
   */
  readonly positionInNote: Pos;

  /**
   * Raw arguments string of the code block.
   */
  readonly rawArgumentsString: string;

  /**
   * A section information of the code block.
   */
  readonly sectionInfo: MarkdownSectionInformation;

  /**
   * A start delimiter of the code block.
   */
  readonly startDelimiter: string;
}

/* v8 ignore stop */
