/**
 * @file
 *
 * Tests for {@link createIncrementalParseStateField}.
 */

import type {
  Input,
  PartialParse,
  TreeFragment
} from '@lezer/common';

import { EditorState } from '@codemirror/state';
import {
  NodeType,
  Parser,
  Tree
} from '@lezer/common';
import {
  describe,
  expect,
  it
} from 'vitest';

import { createIncrementalParseStateField } from './incremental-parse-state-field.ts';

interface ParseCall {
  readonly fragments: readonly TreeFragment[];
  readonly input: Input;
}

const documentType = NodeType.define({ id: 0, name: 'Document', top: true });

class RecordingParser extends Parser {
  public readonly calls: ParseCall[] = [];

  public override createParse(input: Input, fragments: readonly TreeFragment[]): PartialParse {
    this.calls.push({ fragments, input });
    return {
      advance: (): Tree => new Tree(documentType, [], [], input.length),
      parsedPos: 0,
      stopAt: (): void => {
        // Nothing to stop: the parse completes on its first advance.
      },
      stoppedAt: null
    };
  }
}

describe('createIncrementalParseStateField', () => {
  it('should parse the whole document when the state is created', () => {
    const parser = new RecordingParser();
    const field = createIncrementalParseStateField(parser);

    const state = EditorState.create({ doc: 'one\ntwo', extensions: field });

    expect(state.field(field).tree.length).toBe(7);
    expect(state.field(field).fragments).toHaveLength(1);
    expect(parser.calls).toHaveLength(1);
    expect(parser.calls[0]?.fragments).toEqual([]);
  });

  it('should keep the value when the document does not change', () => {
    const parser = new RecordingParser();
    const field = createIncrementalParseStateField(parser);
    const state = EditorState.create({ doc: 'one', extensions: field });

    const nextState = state.update({ selection: { anchor: 1 } }).state;

    expect(nextState.field(field)).toBe(state.field(field));
    expect(parser.calls).toHaveLength(1);
  });

  it('should reparse with the fragments the change left intact', () => {
    const parser = new RecordingParser();
    const field = createIncrementalParseStateField(parser);
    const state = EditorState.create({ doc: 'one two three', extensions: field });

    const nextState = state.update({ changes: { from: 4, insert: 'and ', to: 7 } }).state;

    expect(nextState.field(field).tree.length).toBe(nextState.doc.length);
    expect(parser.calls).toHaveLength(2);
    const reusedFragments = parser.calls[1]?.fragments ?? [];
    expect(reusedFragments.length).toBeGreaterThan(0);
    for (const fragment of reusedFragments) {
      expect(fragment.to <= 4 || fragment.from >= 8).toBe(true);
    }
  });

  it('should read the document one line at a time', () => {
    const parser = new RecordingParser();
    EditorState.create({ doc: 'ab\ncd', extensions: createIncrementalParseStateField(parser) });
    const input = parser.calls[0]?.input;

    expect(input?.length).toBe(5);
    expect(input?.lineChunks).toBe(true);
    expect(input?.chunk(0)).toBe('ab');
    expect(input?.chunk(1)).toBe('b');
    expect(input?.chunk(2)).toBe('\n');
    expect(input?.chunk(3)).toBe('cd');
    expect(input?.chunk(5)).toBe('');
    expect(input?.read(1, 4)).toBe('b\nc');
  });
});
