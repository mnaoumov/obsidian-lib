// @vitest-environment jsdom

import type {
  App as AppOriginal,
  Editor as EditorOriginal,
  EditorPosition
} from 'obsidian';
import type {
  ColorComponent,
  DropdownComponent,
  ExtraButtonComponent,
  SliderComponent,
  TextAreaComponent,
  TextComponent,
  ToggleComponent
} from 'obsidian-test-mocks/obsidian';
import type { Except } from 'type-fest';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { mockImplementation } from '@mnaoumov/typescript-test-toolkit/mock-implementation';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  Modal,
  Notice,
  Setting as SettingOriginal
} from 'obsidian';
import {
  App,
  Setting
} from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  CodeBlockBuilderInput,
  CodeBlockBuilderPreviewParams,
  ShowCodeBlockBuilderParams
} from './code-block-builder.ts';

import { MultipleDropdownComponent } from '../setting-components/multiple-dropdown-component.ts';
import {
  formatCodeBlock,
  showCodeBlockBuilder
} from './code-block-builder.ts';

interface OpenedBuilder {
  readonly modal: Modal;
  readonly result: Promise<null | string>;
}

interface TestEditor {
  readonly editor: EditorOriginal;
  readonly replaceSelection: ReturnType<typeof vi.fn>;
}

let app: AppOriginal;
let settings: Setting[];
let notices: string[];

beforeEach(() => {
  app = App.createConfigured__().asOriginalType__();
  settings = [];
  notices = [];
  mockImplementation({
    $object: SettingOriginal.prototype,
    impl: function impl(this: SettingOriginal, originalImplementation, containerEl: HTMLElement): SettingOriginal {
      originalImplementation.call(this, containerEl);
      settings.push(Setting.fromOriginalType__(this));
      return this;
    },
    method: 'constructor__'
  });
  mockImplementation({
    $object: Notice.prototype,
    impl: function impl(this: Notice, originalImplementation, message: DocumentFragment | string, duration?: number): Notice {
      originalImplementation.call(this, message, duration);
      notices.push(typeof message === 'string' ? message : message.textContent);
      return this;
    },
    method: 'constructor__'
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function changeSelect(selectEl: HTMLSelectElement | undefined, value: string): void {
  const element = ensureNonNullable(selectEl);
  element.value = value;
  element.dispatchEvent(new Event('change'));
}

function createEditor(lineText: string, ch: number): TestEditor {
  const replaceSelection = vi.fn();
  const editor = strictProxy<EditorOriginal>({
    getCursor: (): EditorPosition => ({ ch, line: 0 }),
    getLine: (): string => lineText,
    replaceSelection
  });
  return { editor, replaceSelection };
}

function getComponent(name: string): unknown {
  const setting = ensureNonNullable(settings.find((candidate) => candidate.nameEl.textContent === name), `No setting named ${name}`);
  return setting.components[0];
}

function getOutput(modal: Modal): string {
  return ensureNonNullable(modal.contentEl.querySelector('textarea')).value;
}

function getSelects(name: string): HTMLSelectElement[] {
  const setting = ensureNonNullable(settings.find((candidate) => candidate.nameEl.textContent === name), `No setting named ${name}`);
  return [...setting.controlEl.querySelectorAll('select')];
}

function openBuilder(params: Except<ShowCodeBlockBuilderParams, 'app'>): OpenedBuilder {
  const openedModals: Modal[] = [];
  vi.spyOn(Modal.prototype, 'open').mockImplementation(function open(this: Modal): void {
    openedModals.push(this);
    this.onOpen();
  });
  const result = showCodeBlockBuilder({ app, ...params });
  return { modal: ensureNonNullable(openedModals[0]), result };
}

describe('formatCodeBlock', () => {
  const fields: CodeBlockBuilderInput[] = [
    { defaultValue: 'chart', isRequired: true, key: 'type', name: 'Type', type: 'text' },
    { defaultValue: false, key: 'grid', name: 'Grid', type: 'boolean' },
    {
      fields: [
        { defaultValue: 5, key: 'size', max: 10, min: 1, name: 'Size', step: 1, type: 'slider' },
        { defaultValue: [], key: 'tags', name: 'Tags', options: ['a', 'b'], separator: ';', type: 'multipleDropdown' }
      ],
      name: 'Layout',
      type: 'group'
    },
    { defaultValue: '', key: 'raw', name: 'Raw', shouldOmitKey: true, type: 'text' }
  ];

  it('should write only required and changed values, in field order', () => {
    expect(formatCodeBlock({
      fields,
      language: 'demo',
      values: new Map<string, boolean | number | readonly string[] | string>([
        ['grid', true],
        ['raw', 'free text'],
        ['size', 5],
        ['tags', ['a', 'b']]
      ])
    })).toBe('```demo\ntype: chart\ngrid: true\ntags: a;b\nfree text\n```');
  });

  it('should write an empty block when nothing is set', () => {
    expect(formatCodeBlock({
      fields: [{ defaultValue: '', isRequired: true, key: 'name', name: 'Name', type: 'text' }],
      language: 'demo',
      values: new Map()
    })).toBe('```demo\n```');
  });

  it('should pick a fence longer than any backtick run in the values', () => {
    expect(formatCodeBlock({
      fields: [{ defaultValue: '', key: 'code', name: 'Code', type: 'text' }],
      language: 'demo',
      values: new Map([['code', 'a ```` b']])
    })).toBe('`````demo\ncode: a ```` b\n`````');
  });

  it('should treat an equal array as the default value', () => {
    expect(formatCodeBlock({
      fields: [
        { defaultValue: ['a'], key: 'tags', name: 'Tags', options: ['a', 'b'], type: 'multipleDropdown' },
        { defaultValue: ['a'], key: 'other', name: 'Other', options: ['a', 'b'], type: 'multipleDropdown' }
      ],
      language: 'demo',
      values: new Map([['other', ['b']], ['tags', ['a']]])
    })).toBe('```demo\nother: b\n```');
  });
});

describe('showCodeBlockBuilder', () => {
  it('should render every field kind and update the output on each change', async () => {
    await app.vault.createFolder('Notes');
    await app.vault.createFolder('Archive');
    const previews: CodeBlockBuilderPreviewParams[] = [];
    const { modal } = openBuilder({
      editor: null,
      fields: [
        { defaultValue: false, key: 'grid', name: 'Grid', type: 'boolean' },
        { defaultValue: '#000000', key: 'color', name: 'Color', type: 'color' },
        {
          defaultValue: 'rose',
          groups: [{ name: 'Fruits', options: ['apple', 'pear'] }, { name: 'Flowers', options: { rose: 'Rose', tulip: 'Tulip' } }],
          key: 'item',
          name: 'Item',
          type: 'conditionalDropdown'
        },
        { defaultValue: 'a', key: 'mode', name: 'Mode', options: { a: 'A', b: 'B' }, type: 'dropdown' },
        { defaultValue: '/', description: 'Where to look', key: 'folder', name: 'Folder', type: 'folder' },
        { defaultValue: ['x'], key: 'tags', name: 'Tags', options: ['x', 'y'], type: 'multipleDropdown' },
        { defaultValue: 20, key: 'size', max: 10, min: 1, name: 'Size', step: 1, type: 'slider' },
        { defaultValue: 'chart', isRequired: true, key: 'type', name: 'Type', placeholder: 'chart', type: 'text' }
      ],
      language: 'demo',
      onUpdatePreview: (params) => {
        previews.push(params);
      },
      title: 'Build a chart'
    });

    expect(modal.titleEl.textContent).toBe('Build a chart');
    expect(settings[0]?.nameEl.textContent).toBe('Type');
    expect(getOutput(modal)).toBe('```demo\ntype: chart\n```');
    expect(previews).toHaveLength(1);

    castTo<ToggleComponent>(getComponent('Grid')).onClick();

    const colorPicker = castTo<ColorComponent>(getComponent('Color'));
    colorPicker.colorPickerEl.value = '#ff0000';
    colorPicker.colorPickerEl.dispatchEvent(new Event('change'));

    const [groupSelectEl, itemSelectEl] = getSelects('Item');
    expect(groupSelectEl?.value).toBe('1');
    expect(itemSelectEl?.value).toBe('rose');
    changeSelect(groupSelectEl, '0');
    expect(itemSelectEl?.value).toBe('apple');
    changeSelect(itemSelectEl, 'pear');

    const modeDropdown = castTo<DropdownComponent>(getComponent('Mode'));
    modeDropdown.selectEl.value = 'b';
    modeDropdown.simulateChange__();

    const folderDropdown = castTo<DropdownComponent>(getComponent('Folder'));
    expect([...folderDropdown.selectEl.options].map((option) => option.value)).toEqual(['/', 'Archive', 'Notes']);
    folderDropdown.selectEl.value = 'Notes';
    folderDropdown.simulateChange__();

    const tagsDropdown = castTo<MultipleDropdownComponent>(getComponent('Tags'));
    expect(tagsDropdown).toBeInstanceOf(MultipleDropdownComponent);
    tagsDropdown.setValue(['x', 'y']);
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- The test-only change simulation is what this test needs.
    tagsDropdown.simulateChange__();

    const slider = castTo<SliderComponent>(getComponent('Size'));
    slider.sliderEl.value = '3';
    slider.sliderEl.dispatchEvent(new Event('input'));
    slider.sliderEl.dispatchEvent(new Event('change'));

    expect(getOutput(modal)).toBe('```demo\ngrid: true\ncolor: #ff0000\nitem: pear\nmode: b\nfolder: Notes\ntags: x,y\nsize: 3\ntype: chart\n```');
    expect(previews.at(-1)?.values.get('size')).toBe(3);
    expect(previews.at(-1)?.previewEl.hasClass('code-block-builder-preview')).toBe(true);
    modal.close();
  });

  it('should reset each optional field to its default', () => {
    const { modal } = openBuilder({
      editor: null,
      fields: [
        { defaultValue: false, key: 'grid', name: 'Grid', type: 'boolean' },
        { defaultValue: '#000000', key: 'color', name: 'Color', type: 'color' },
        {
          defaultValue: 'rose',
          groups: [{ name: 'Fruits', options: ['apple'] }, { name: 'Flowers', options: ['rose'] }],
          key: 'item',
          name: 'Item',
          type: 'conditionalDropdown'
        },
        {
          defaultValue: 's',
          groups: [{ name: 'None', options: [] }, { name: 'Some', options: ['s'] }],
          key: 'empty',
          name: 'Empty',
          type: 'conditionalDropdown'
        },
        { defaultValue: '', groups: [], key: 'nothing', name: 'Nothing', type: 'conditionalDropdown' },
        { defaultValue: 'a', key: 'mode', name: 'Mode', options: ['a', 'b'], type: 'dropdown' },
        { defaultValue: 'Missing', key: 'folder', name: 'Folder', type: 'folder' },
        { defaultValue: [], key: 'tags', name: 'Tags', options: ['x'], type: 'multipleDropdown' },
        { defaultValue: 5, key: 'size', max: 10, min: 1, name: 'Size', step: 1, type: 'slider' },
        { defaultValue: '', key: 'label', name: 'Label', type: 'text' }
      ],
      language: 'demo'
    });

    castTo<ToggleComponent>(getComponent('Grid')).onClick();
    changeSelect(getSelects('Item')[0], '0');
    changeSelect(getSelects('Empty')[0], '0');
    const labelText = castTo<TextComponent>(getComponent('Label'));
    labelText.inputEl.value = 'hello';
    labelText.onChanged();
    expect(getOutput(modal)).toBe('```demo\ngrid: true\nitem: apple\nlabel: hello\n```');

    for (const name of ['Grid', 'Color', 'Item', 'Empty', 'Mode', 'Folder', 'Tags', 'Size', 'Label']) {
      const setting = ensureNonNullable(settings.find((candidate) => candidate.nameEl.textContent === name));
      castTo<ExtraButtonComponent>(setting.components.at(-1)).simulateClick__();
    }

    expect(getOutput(modal)).toBe('```demo\n```');
    expect(getSelects('Item')[1]?.value).toBe('rose');
    expect(getSelects('Empty')[1]?.value).toBe('s');
    expect(castTo<DropdownComponent>(getComponent('Folder')).getValue()).toBe('Missing');
    modal.close();
  });

  it('should keep the last valid value of a text field with a pattern', () => {
    const { modal } = openBuilder({
      editor: null,
      fields: [{ defaultValue: '1', key: 'count', name: 'Count', type: 'text', validationPattern: /^\d+$/g }],
      language: 'demo'
    });

    const text = castTo<TextComponent>(getComponent('Count'));
    text.inputEl.value = '42';
    text.onChanged();
    text.inputEl.value = 'abc';
    text.onChanged();
    expect(text.inputEl.validationMessage).not.toBe('');
    expect(getOutput(modal)).toBe('```demo\ncount: 42\n```');
    text.inputEl.value = '43';
    text.onChanged();
    expect(text.inputEl.validationMessage).toBe('');
    expect(getOutput(modal)).toBe('```demo\ncount: 43\n```');
    modal.close();
  });

  it('should expand one group at a time', () => {
    const { modal } = openBuilder({
      editor: null,
      fields: [
        { fields: [{ defaultValue: false, key: 'a', name: 'A', type: 'boolean' }], isInitiallyExpanded: true, name: 'First', type: 'group' },
        { fields: [{ defaultValue: false, key: 'b', name: 'B', type: 'boolean' }], name: 'Second', type: 'group' }
      ],
      language: 'demo'
    });

    const groupEls = [...modal.contentEl.querySelectorAll('.code-block-builder-group')];
    function getCollapsedStates(): boolean[] {
      return groupEls.map((groupEl) => groupEl.hasClass('is-collapsed'));
    }
    expect(getCollapsedStates()).toEqual([false, true]);

    castTo<ExtraButtonComponent>(getComponent('Second')).simulateClick__();
    expect(getCollapsedStates()).toEqual([true, false]);

    castTo<ExtraButtonComponent>(getComponent('Second')).simulateClick__();
    expect(getCollapsedStates()).toEqual([true, true]);

    castTo<ToggleComponent>(getComponent('B')).onClick();
    expect(getOutput(modal)).toBe('```demo\nb: true\n```');
    modal.close();
  });

  it('should insert the code block on a new line and resolve with it', async () => {
    const { editor, replaceSelection } = createEditor('text', 4);
    const { modal, result } = openBuilder({
      editor,
      fields: [{ defaultValue: 'x', isRequired: true, key: 'name', name: 'Name', type: 'text' }],
      language: 'demo'
    });

    const outputSetting = ensureNonNullable(settings.find((setting) => setting.settingEl.hasClass('code-block-builder-output')));
    expect(castTo<TextAreaComponent>(outputSetting.components[0]).inputEl.readOnly).toBe(true);
    castTo<ExtraButtonComponent>(outputSetting.components[2]).simulateClick__();

    expect(replaceSelection).toHaveBeenCalledWith('\n```demo\nname: x\n```\n');
    expect(await result).toBe('```demo\nname: x\n```');
    expect(modal.titleEl.textContent).toBe('mock-translation');
  });

  it('should insert without a leading line break at the start of a line', async () => {
    const { editor, replaceSelection } = createEditor('', 0);
    const { result } = openBuilder({
      editor,
      fields: [],
      language: 'demo'
    });

    const outputSetting = ensureNonNullable(settings.find((setting) => setting.settingEl.hasClass('code-block-builder-output')));
    castTo<ExtraButtonComponent>(outputSetting.components[2]).simulateClick__();

    expect(replaceSelection).toHaveBeenCalledWith('```demo\n```\n');
    await result;
  });

  it('should default to the active editor and resolve null without inserting', async () => {
    const { editor } = createEditor('', 0);
    Object.defineProperty(app.workspace, 'activeEditor', { configurable: true, value: { editor } });
    const { modal, result } = openBuilder({ fields: [], language: 'demo' });
    modal.close();
    expect(await result).toBeNull();
  });

  it('should explain when there is no editor to insert into', async () => {
    const { modal, result } = openBuilder({ fields: [], language: 'demo' });
    const outputSetting = ensureNonNullable(settings.find((setting) => setting.settingEl.hasClass('code-block-builder-output')));
    castTo<ExtraButtonComponent>(outputSetting.components[2]).simulateClick__();
    expect(notices).toEqual(['mock-translation']);
    modal.close();
    expect(await result).toBeNull();
  });

  it('should copy the code block and report a failed copy', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { modal } = openBuilder({ editor: null, fields: [], language: 'demo' });
    const outputSetting = ensureNonNullable(settings.find((setting) => setting.settingEl.hasClass('code-block-builder-output')));
    const copyButton = castTo<ExtraButtonComponent>(outputSetting.components[1]);

    copyButton.simulateClick__();
    await vi.waitFor(() => {
      expect(notices).toHaveLength(1);
    });
    copyButton.simulateClick__();
    await vi.waitFor(() => {
      expect(notices).toHaveLength(2);
    });

    expect(writeText).toHaveBeenCalledWith('```demo\n```');
    modal.close();
  });

  it('should reject an unknown field type', async () => {
    const { result } = openBuilder({
      editor: null,
      fields: [castTo<CodeBlockBuilderInput>({ defaultValue: '', key: 'x', name: 'X', type: 'unknown' })],
      language: 'demo'
    });
    await expect(result).rejects.toThrow();
  });
});

vi.mock('../i18n/i18n.ts', () => ({
  t: vi.fn((selector: unknown) => {
    if (typeof selector === 'function') {
      const proxy: unknown = new Proxy({}, { get: (): unknown => proxy });
      (selector as (root: unknown) => unknown)(proxy);
    }
    return 'mock-translation';
  })
}));
