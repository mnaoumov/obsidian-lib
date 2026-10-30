/**
 * @file
 *
 * A {@link StateField} holding a Lezer syntax tree of the whole document, parsed again incrementally on every change.
 *
 * Each change maps the previous parse's {@link TreeFragment}s through the changed ranges and hands them to the
 * parser, which reuses every fragment the change did not touch. The parse is synchronous and runs to the end of
 * the document, so it suits a grammar a plugin owns (a markup extension, a small DSL) rather than a full language
 * on a large document, where `@codemirror/language`'s time-sliced parser is the better tool.
 *
 * `@lezer/common` is in the module map Obsidian hands to plugins, so this costs a consuming plugin no bundle.
 */

import type { Text } from '@codemirror/state';
import type {
  ChangedRange,
  Input,
  Parser,
  Tree
} from '@lezer/common';

import { StateField } from '@codemirror/state';
import { TreeFragment } from '@lezer/common';

/**
 * The value of an incremental parse state field.
 */
export interface IncrementalParse {
  /**
   * The fragments of {@link IncrementalParse.tree} that the next parse may reuse.
   */
  readonly fragments: readonly TreeFragment[];

  /**
   * The syntax tree of the whole document.
   */
  readonly tree: Tree;
}

/**
 * Creates a state field that parses the document with the given parser when the state is created, and parses it again
 * incrementally on every document change, reusing the fragments the change left intact.
 *
 * @param parser - The Lezer parser to parse the document with.
 * @returns The state field. Add it to the editor's extensions and read it with `state.field(field).tree`.
 */
export function createIncrementalParseStateField(parser: Parser): StateField<IncrementalParse> {
  return StateField.define<IncrementalParse>({
    create(state) {
      const tree = parser.parse(createTextInput(state.doc));
      return { fragments: TreeFragment.addTree(tree), tree };
    },
    update(value, transaction) {
      if (!transaction.docChanged) {
        return value;
      }

      const changedRanges: ChangedRange[] = [];
      transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
        changedRanges.push({ fromA, fromB, toA, toB });
      });
      const reusableFragments = TreeFragment.applyChanges(value.fragments, changedRanges);
      const tree = parser.parse(createTextInput(transaction.newDoc), reusableFragments);
      return { fragments: TreeFragment.addTree(tree, reusableFragments), tree };
    }
  });
}

/**
 * Reads a CodeMirror document as a Lezer {@link Input} one line at a time, so a parse never copies the whole document
 * into one string.
 *
 * @param text - The document to read.
 * @returns The input.
 */
function createTextInput(text: Text): Input {
  return {
    chunk(from: number): string {
      const line = text.lineAt(from);
      if (from < line.to) {
        return text.sliceString(from, line.to);
      }
      return line.number < text.lines ? '\n' : '';
    },
    length: text.length,
    lineChunks: true,
    read(from: number, to: number): string {
      return text.sliceString(from, to);
    }
  };
}
