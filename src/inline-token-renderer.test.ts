// @vitest-environment jsdom

/**
 * @file
 *
 * Tests for {@link createInlineTokenPostProcessor} and {@link registerInlineTokenRenderer}.
 */

import type { Extension } from '@codemirror/state';

import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { InlineTokenRenderParams } from './codemirror/inline-token-widgets.ts';
import type { MarkdownPostProcessorRegistrarRegisterMarkdownPostProcessorParams } from './markdown-post-processor-registrar.ts';

import {
  createInlineTokenPostProcessor,
  registerInlineTokenRenderer
} from './inline-token-renderer.ts';

function createElement(html: string): HTMLElement {
  const element = createDiv();
  element.append(...new DOMParser().parseFromString(html, 'text/html').body.childNodes);
  return element;
}

function renderName({ containerEl, match }: InlineTokenRenderParams): void {
  containerEl.textContent = `<${match[1] ?? ''}>`;
}

describe('createInlineTokenPostProcessor', () => {
  it('should render every match in the text and keep the text around it', () => {
    const element = createElement('<p>a :one: b <em>:two:</em> c</p>');
    createInlineTokenPostProcessor({ regExp: /:(?<name>\w+):/, render: renderName })(element, { sourcePath: 'note.md' });

    expect(element.innerHTML).toBe(
      '<p>a <span class="obsidian-lib inline-token">&lt;one&gt;</span> b <em><span class="obsidian-lib inline-token">&lt;two&gt;</span></em> c</p>'
    );
  });

  it('should skip text inside code by default', () => {
    const element = createElement('<p><code>:one:</code></p><pre><code>:two:</code></pre>');
    const html = element.innerHTML;
    createInlineTokenPostProcessor({ regExp: /:(?<name>\w+):/, render: renderName })(element, { sourcePath: '' });

    expect(element.innerHTML).toBe(html);
  });

  it('should skip text inside the elements a custom selector names, and match inside code then', () => {
    const element = createElement('<p><code>:one:</code> <a>:two:</a></p>');
    createInlineTokenPostProcessor({ regExp: /:(?<name>\w+):/, render: renderName, skipSelector: 'a' })(element, { sourcePath: '' });

    expect(element.querySelector('code')?.textContent).toBe('<one>');
    expect(element.querySelector('a')?.textContent).toBe(':two:');
  });

  it('should hand the render the source path and no editor state', () => {
    const render = vi.fn(renderName);
    createInlineTokenPostProcessor({ regExp: /:(?<name>\w+):/, render })(createElement(':one:'), { sourcePath: 'folder/note.md' });

    expect(render).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: 'folder/note.md' }));
    expect(render.mock.calls[0]?.[0].state).toBeUndefined();
  });
});

describe('registerInlineTokenRenderer', () => {
  it('should register a post processor and an editor extension from one definition', () => {
    const postProcessors: MarkdownPostProcessorRegistrarRegisterMarkdownPostProcessorParams[] = [];
    const extensions: Extension[] = [];
    registerInlineTokenRenderer({
      editorExtensionRegistrar: {
        registerEditorExtension(extension): void {
          extensions.push(extension);
        }
      },
      markdownPostProcessorRegistrar: {
        registerMarkdownPostProcessor(params): void {
          postProcessors.push(params);
        }
      },
      regExp: /:(?<name>\w+):/,
      render: renderName,
      sortOrder: 5
    });

    expect(extensions).toHaveLength(1);
    expect(postProcessors).toHaveLength(1);
    expect(postProcessors[0]?.sortOrder).toBe(5);
  });

  it('should leave the post processor sort order unset when none is given', () => {
    const postProcessors: MarkdownPostProcessorRegistrarRegisterMarkdownPostProcessorParams[] = [];
    registerInlineTokenRenderer({
      editorExtensionRegistrar: { registerEditorExtension: vi.fn() },
      markdownPostProcessorRegistrar: {
        registerMarkdownPostProcessor(params): void {
          postProcessors.push(params);
        }
      },
      regExp: /:(?<name>\w+):/,
      render: renderName
    });

    expect(postProcessors[0]).not.toHaveProperty('sortOrder');
  });
});
