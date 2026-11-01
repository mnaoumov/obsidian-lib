// @vitest-environment jsdom

import type {
  App as AppOriginal,
  Editor as EditorOriginal,
  EditorPosition,
  EditorSuggest as EditorSuggestOriginal,
  EditorSuggestTriggerInfo,
  TFile as TFileOriginal
} from 'obsidian';
import type { Mock } from 'vitest';

import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  CommandEditorSuggest,
  prioritizeEditorSuggest
} from './editor-suggest.ts';

class DefaultSuggest extends CommandEditorSuggest<string> {
  public getSuggestions(): string[] {
    return [];
  }

  public renderSuggestion(): void {
    // Nothing to render in a unit test.
  }

  public selectSuggestion(): void {
    // Nothing to select in a unit test.
  }
}

class TestSuggest extends CommandEditorSuggest<string> {
  public textTrigger: EditorSuggestTriggerInfo | null = null;
  public override readonly trigger = vi.fn((editor: EditorOriginal, file: null | TFileOriginal) => this.onTrigger(editor.getCursor(), editor, file) !== null);

  public getSuggestions(): string[] {
    return [];
  }

  public renderSuggestion(): void {
    // Nothing to render in a unit test.
  }

  public selectSuggestion(): void {
    // Nothing to select in a unit test.
  }

  protected override onTextTrigger(): EditorSuggestTriggerInfo | null {
    return this.textTrigger;
  }
}

function createEditor(line: string, getCursor: () => EditorPosition): EditorOriginal {
  return strictProxy<EditorOriginal>({
    getCursor,
    getLine: () => line
  });
}

describe('CommandEditorSuggest', () => {
  let setCurrentSuggest: Mock<(suggest: unknown) => void>;
  let app: AppOriginal;

  beforeEach(() => {
    setCurrentSuggest = vi.fn<(suggest: unknown) => void>();
    app = strictProxy<AppOriginal>({ keymap: {}, scope: {}, workspace: { editorSuggest: { setCurrentSuggest } } });
  });

  it('should open at the cursor and use the typed text as the query', () => {
    const suggest = new TestSuggest(app);
    let cursor: EditorPosition = { ch: 4, line: 1 };
    const editor = createEditor('abc xyz', () => cursor);

    expect(suggest.openFromCommand({ editor, file: null })).toBe(true);
    expect(setCurrentSuggest).toHaveBeenCalledWith(suggest);

    cursor = { ch: 6, line: 1 };
    expect(suggest.onTrigger(cursor, editor, null)).toEqual({ end: cursor, query: 'xy', start: { ch: 4, line: 1 } });

    cursor = { ch: 2, line: 1 };
    expect(suggest.onTrigger(cursor, editor, null)).toBeNull();
    expect(suggest.onTrigger({ ch: 6, line: 1 }, editor, null)).toBeNull();
  });

  it('should end the session when the cursor leaves the line or the suggest closes', () => {
    const suggest = new TestSuggest(app);
    const editor = createEditor('abc', () => ({ ch: 1, line: 0 }));
    suggest.openFromCommand({ editor, file: null });
    expect(suggest.onTrigger({ ch: 1, line: 1 }, editor, null)).toBeNull();

    suggest.openFromCommand({ editor, file: null });
    suggest.close();
    expect(suggest.onTrigger({ ch: 2, line: 0 }, editor, null)).toBeNull();
  });

  it('should fall back to the text trigger outside a session', () => {
    const suggest = new TestSuggest(app);
    const info = { end: { ch: 1, line: 0 }, query: '', start: { ch: 0, line: 0 } };
    suggest.textTrigger = info;
    expect(suggest.onTrigger({ ch: 1, line: 0 }, createEditor('', () => ({ ch: 0, line: 0 })), null)).toBe(info);
  });

  it('should report a refused trigger', () => {
    const suggest = new TestSuggest(app);
    suggest.trigger.mockReturnValue(false);
    expect(suggest.openFromCommand({ editor: createEditor('', () => ({ ch: 0, line: 0 })), file: null })).toBe(false);
    expect(setCurrentSuggest).not.toHaveBeenCalled();
    expect(suggest.onTrigger({ ch: 0, line: 0 }, createEditor('', () => ({ ch: 0, line: 0 })), null)).toBeNull();
  });

  it('should not open on typed text by default', () => {
    const suggest = new DefaultSuggest(app);
    expect(suggest.onTrigger({ ch: 0, line: 0 }, createEditor('', () => ({ ch: 0, line: 0 })), null)).toBeNull();
  });
});

describe('prioritizeEditorSuggest', () => {
  it('should move the suggest to the front', () => {
    const first = strictProxy<EditorSuggestOriginal<unknown>>({});
    const second = strictProxy<EditorSuggestOriginal<unknown>>({});
    const suggests = [first, second];
    const app = strictProxy<AppOriginal>({ workspace: { editorSuggest: { suggests } } });
    prioritizeEditorSuggest({ app, editorSuggest: second });
    expect(suggests).toEqual([second, first]);
    expect(suggests[0]).toBe(second);
  });

  it('should throw for a suggest that is not registered', () => {
    const app = strictProxy<AppOriginal>({ workspace: { editorSuggest: { suggests: [] } } });
    expect(() => {
      prioritizeEditorSuggest({ app, editorSuggest: strictProxy<EditorSuggestOriginal<unknown>>({}) });
    }).toThrow('not registered');
  });
});
