import type {
  GenericFunction,
  GenericVoidFunction
} from '@mnaoumov/typescript-lib/function';
import type {
  App as AppOriginal,
  Plugin,
  Setting as SettingApi,
  SettingDefinitionGroup,
  SettingDefinitionItem,
  SettingDefinitionRender,
  SettingGroup as SettingGroupApi
} from 'obsidian';

import {
  noop,
  noopAsync
} from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  App,
  Setting,
  SettingGroup
} from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  PluginSettingsComponentBase,
  PluginSettingsImportResult
} from '../components/plugin-settings-component.ts';
import type { ValueComponentWithChangeTracking } from '../setting-components/value-component-with-change-tracking.ts';
import type { SettingsRecoveryCopy } from '../settings-recovery.ts';
import type {
  PluginSettingsTabBaseSettingExParams,
  PluginSettingsTabBaseSettingGroupExParams
} from './plugin-settings-tab.ts';

import { PluginSettingsImportError } from '../components/plugin-settings-component.ts';
import { SettingsRecoveryCopyAction } from '../modals/settings-recovery-copies.ts';
import { SettingEx } from '../setting-ex.ts';
import { SettingsRecoveryReason } from '../settings-recovery.ts';
import {
  PluginSettingsTabBase,
  SAVE_TO_FILE_CONTEXT,
  SETTINGS_MANAGEMENT_CONTEXT
} from './plugin-settings-tab.ts';

vi.mock('../css-class.ts', () => ({
  CssClass: {
    LibraryName: 'obsidian-lib',
    PluginSettingsTab: 'plugin-settings-tab',
    RecoveryCopiesButton: 'recovery-copies-button',
    Tooltip: 'tooltip',
    TooltipArrow: 'tooltip-arrow',
    TooltipValidator: 'tooltip-validator'
  }
}));

vi.mock('./plugin-context.ts', () => ({
  addPluginCssClasses: vi.fn()
}));

const {
  mockConfirm,
  mockCopyTextManually,
  mockNotice,
  mockPrompt,
  mockSelectSettingsRecoveryCopy
} = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  mockCopyTextManually: vi.fn(),
  mockNotice: vi.fn(),
  mockPrompt: vi.fn(),
  mockSelectSettingsRecoveryCopy: vi.fn()
}));

vi.mock('obsidian', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian')>(),
  Notice: mockNotice
}));

vi.mock('../modals/confirm.ts', () => ({
  confirm: mockConfirm
}));

vi.mock('../modals/copy-text-manually.ts', () => ({
  copyTextManually: mockCopyTextManually
}));

vi.mock('../modals/prompt.ts', () => ({
  prompt: mockPrompt
}));

vi.mock('../modals/settings-recovery-copies.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../modals/settings-recovery-copies.ts')>(),
  selectSettingsRecoveryCopy: mockSelectSettingsRecoveryCopy
}));

interface EventListenerEntry {
  readonly 0: string;
  readonly 1: GenericFunction;
}

interface MockValueComponentBase {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Change tracking wraps and replaces the component callback registration method.
  onChange: ReturnType<typeof vi.fn>;
  readonly setValue: ReturnType<typeof vi.fn>;
}

interface MockValueComponentWithValidator extends MockValueComponentBase {
  readonly validatorEl: HTMLElement;
}

interface TestSettings {
  readonly enabled: boolean;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Tests change the setting value before rendering settings.
  name: string;
}

interface TextBasedMockComponentShape extends MockValueComponentBase {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Tests replace the component clearing method for settings updates.
  empty: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Tests replace the component emptiness check for each settings scenario.
  isEmpty: ReturnType<typeof vi.fn>;
  readonly setPlaceholderValue: ReturnType<typeof vi.fn>;
}

class DeclarativeSettingsTab extends PluginSettingsTabBase<TestSettings> {
  public definitionItems: SettingDefinitionItem[] = [];

  public override getSettingDefinitionItems(): SettingDefinitionItem[] {
    return this.definitionItems;
  }

  public override settingEx(params: PluginSettingsTabBaseSettingExParams): SettingDefinitionRender {
    return super.settingEx(params);
  }

  public override settingGroupEx(params: PluginSettingsTabBaseSettingGroupExParams): SettingDefinitionGroup {
    return super.settingGroupEx(params);
  }

  public override settingsManagementEx(): SettingDefinitionRender {
    return super.settingsManagementEx();
  }
}

class TestSettingsTab extends PluginSettingsTabBase<TestSettings> {
  public displayCalled = false;

  public override displayLegacy(): void {
    super.displayLegacy();
    this.displayCalled = true;
  }
}

function createMockPlugin(appInstance: AppOriginal): Plugin {
  return strictProxy<Plugin>({
    app: appInstance,
    manifest: { id: 'test-plugin' }
  });
}

function createMockSettingsComponent(overrides: Partial<PluginSettingsComponentBase<TestSettings>> = {}): PluginSettingsComponentBase<TestSettings> {
  return strictProxy<PluginSettingsComponentBase<TestSettings>>({
    getRecoveryCopies: vi.fn(() => Promise.resolve([])),
    ...overrides,
    defaultSettings: { enabled: false, name: 'default' },
    on: castTo<PluginSettingsComponentBase<TestSettings>['on']>(vi.fn((_name: string, _callback: GenericVoidFunction) => ({
      asyncEventSource: {
        offref: vi.fn()
      }
    }))),
    revalidate: vi.fn(() => Promise.resolve({ enabled: '', name: '' })),
    saveToFile: vi.fn(() => noopAsync()),
    setProperty: vi.fn(() => Promise.resolve('')),
    settingsState: {
      effectiveValues: { enabled: false, name: 'test' },
      inputValues: { enabled: false, name: 'test' },
      validationMessages: { enabled: '', name: '' }
    }
  });
}

let app: AppOriginal;

beforeEach(() => {
  vi.clearAllMocks();
  app = App.createConfigured__().asOriginalType__();
});

function stubRequestAnimationFrame(): void {
  vi.stubGlobal('window.requestAnimationFrame', (callback: () => void) => {
    callback();
    return 0;
  });
}

describe('PluginSettingsTabBase', () => {
  it('should create with correct params', () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
    expect(tab).toBeDefined();
    expect(tab.isOpen).toBe(false);
  });

  it('should set isOpen to true on display', () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });

    tab.displayLegacy();

    expect(tab.isOpen).toBe(true);
    expect(tab.displayCalled).toBe(true);
  });

  it('should delegate display to displayLegacy', () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });

    const displayLegacySpy = vi.spyOn(tab, 'displayLegacy');

    tab.display();

    expect(displayLegacySpy).toHaveBeenCalled();
  });

  it('should set isOpen to false on hide', () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });

    tab.displayLegacy();
    expect(tab.isOpen).toBe(true);

    tab.hide();
    expect(tab.isOpen).toBe(false);
  });

  it('should save settings on hideAsync', async () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });

    await tab.hideAsync();

    expect(pluginSettingsComponent.saveToFile).toHaveBeenCalledWith(SAVE_TO_FILE_CONTEXT);
  });

  it('should open settings tab via show()', () => {
    const openTab = vi.fn();
    const appWithSetting = strictProxy<AppOriginal>({
      setting: { openTab }
    });
    const plugin = createMockPlugin(appWithSetting);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });

    tab.show();

    expect(openTab).toHaveBeenCalledWith(tab);
  });

  it('should bind a value component to a setting', () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
    tab.displayLegacy();

    const onChange = vi.fn();
    const setValue = vi.fn();
    const mockComponent = castTo<ValueComponentWithChangeTracking<string>>({
      onChange: vi.fn((callback: GenericFunction) => {
        onChange.mockImplementation(callback);
        return mockComponent;
      }),
      setValue
    });

    const result = tab.bind({ propertyName: 'name', valueComponent: mockComponent });
    expect(result).toBe(mockComponent);
    expect(setValue).toHaveBeenCalledWith('test');
  });

  it('should call onChanged callback when value changes', async () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
    tab.displayLegacy();

    let changeCallback: ((value: string) => Promise<void>) | undefined;
    const setValue = vi.fn();
    const mockComponent = castTo<ValueComponentWithChangeTracking<string>>({
      onChange: vi.fn((callback: (value: string) => Promise<void>) => {
        changeCallback = callback;
        return mockComponent;
      }),
      setValue
    });

    const onChangedSpy = vi.fn();
    tab.bind({ onChanged: onChangedSpy, propertyName: 'name', valueComponent: mockComponent });

    if (changeCallback) {
      await changeCallback('newValue');
    }

    expect(pluginSettingsComponent.setProperty).toHaveBeenCalledWith('name', 'newValue');
  });

  it('should register loadSettings and saveSettings event handlers on display', () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });

    tab.displayLegacy();

    expect(pluginSettingsComponent.on).toHaveBeenCalledWith('loadSettings', expect.any(Function));
    expect(pluginSettingsComponent.on).toHaveBeenCalledWith('saveSettings', expect.any(Function));
  });

  it('should revalidate settings', async () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
    tab.displayLegacy();

    await tab['revalidate']();

    expect(pluginSettingsComponent.revalidate).toHaveBeenCalled();
  });

  it('should use placeholder for default values with text-based component', () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
    tab.displayLegacy();

    // When value equals default, text-based component should be emptied
    (pluginSettingsComponent.settingsState.inputValues as TestSettings).name = 'default';

    const mockComponent = createTextBasedMockComponent();

    tab.bind({ propertyName: 'name', valueComponent: mockComponent });
    expect(mockComponent.setPlaceholderValue).toHaveBeenCalledWith('default');
  });

  it('should handle onChange with value converter returning validation message', async () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
    tab.displayLegacy();

    let changeCallback: ((value: string) => Promise<void>) | undefined;
    const mockComponent = castTo<ValueComponentWithChangeTracking<string>>({
      onChange: vi.fn((callback: (value: string) => Promise<void>) => {
        changeCallback = callback;
        return mockComponent;
      }),
      setValue: vi.fn()
    });

    tab.bind({
      componentToPluginSettingsValueConverter: () => ({
        validationMessage: 'Invalid value'
      }),
      pluginSettingsToComponentValueConverter: (v: string) => v,
      propertyName: 'name',
      valueComponent: mockComponent
    });

    if (changeCallback) {
      await changeCallback('badValue');
    }

    // setProperty should NOT have been called since validation failed
    expect(pluginSettingsComponent.setProperty).not.toHaveBeenCalled();
  });

  it('should handle onChange with text-based component that resets to default when empty', async () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
    tab.displayLegacy();

    let changeCallback: ((value: string) => Promise<void>) | undefined;
    const mockComponent = createTextBasedMockComponent();
    mockComponent.onChange = castTo<typeof mockComponent.onChange>(vi.fn((callback: (value: string) => Promise<void>) => {
      changeCallback = callback;
      return mockComponent;
    }));
    mockComponent.isEmpty = castTo<typeof mockComponent.isEmpty>(vi.fn(() => true));

    tab.bind({ propertyName: 'name', valueComponent: mockComponent });

    if (changeCallback) {
      await changeCallback('');
    }

    expect(pluginSettingsComponent.setProperty).toHaveBeenCalledWith('name', 'default');
  });

  it('should handle onChange with skipOnChange flag', async () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
    tab.displayLegacy();

    let changeCallback: ((value: string) => Promise<void>) | undefined;
    const mockComponent = castTo<ValueComponentWithChangeTracking<string>>({
      onChange: vi.fn((callback: (value: string) => Promise<void>) => {
        changeCallback = callback;
        return mockComponent;
      }),
      setValue: vi.fn()
    });

    tab.bind({ propertyName: 'name', valueComponent: mockComponent });

    // First call sets things up
    if (!changeCallback) {
      return;
    }

    await changeCallback('value1');
    expect(pluginSettingsComponent.setProperty).toHaveBeenCalledTimes(1);
  });

  it('should handle bind with validatorElement', () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
    tab.displayLegacy();

    const parentElement = createDiv();
    const validatorEl = createEl('input');
    parentElement.append(validatorEl);
    validatorEl.isActiveElement = vi.fn(() => false);

    const mockComponent = castTo<MockValueComponentWithValidator & ValueComponentWithChangeTracking<string>>({
      onChange: vi.fn(() => mockComponent),
      setValue: vi.fn(),
      validatorEl
    });

    const result = tab.bind({ propertyName: 'name', valueComponent: mockComponent });
    expect(result).toBe(mockComponent);
  });

  it('should handle bind with shouldShowValidationMessage=false', async () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
    tab.displayLegacy();

    const parentElement = createDiv();
    const validatorEl = createEl('input');
    parentElement.append(validatorEl);
    validatorEl.isActiveElement = vi.fn(() => false);

    let changeCallback: ((value: string) => Promise<void>) | undefined;
    const mockComponent = castTo<MockValueComponentWithValidator & ValueComponentWithChangeTracking<string>>({
      onChange: vi.fn((callback: (value: string) => Promise<void>) => {
        changeCallback = callback;
        return mockComponent;
      }),
      setValue: vi.fn(),
      validatorEl
    });

    vi.mocked(pluginSettingsComponent.setProperty).mockResolvedValue('Some error');

    tab.bind({ propertyName: 'name', shouldShowValidationMessage: false, valueComponent: mockComponent });

    if (changeCallback) {
      await changeCallback('value');
    }
  });

  it('should handle onSaveSettings with SAVE_TO_FILE_CONTEXT', async () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
    tab.displayLegacy();

    // Get the saveSettings callback
    const onCalls: EventListenerEntry[] = vi.mocked(pluginSettingsComponent.on).mock.calls;
    const onCall = onCalls.find((call) => call[0] === 'saveSettings');
    const saveSettingsCallback = onCall?.[1] as (
      newState: unknown,
      oldState: unknown,
      context: unknown
    ) => Promise<void>;

    // Call with SAVE_TO_FILE_CONTEXT
    const state = {
      validationMessages: { enabled: '', name: 'error' }
    };
    await saveSettingsCallback(state, state, SAVE_TO_FILE_CONTEXT);
  });

  it('should refresh when onSaveSettings is called with non-tab context', async () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
    tab.displayLegacy();

    // Obsidian re-renders from `update()`: it refreshes the definitions and, for a tab that provides none,
    // falls back to `display()` -> `displayLegacy()`.
    const updateSpy = vi.spyOn(tab, 'update');

    const onCalls: EventListenerEntry[] = vi.mocked(pluginSettingsComponent.on).mock.calls;
    const onCall = onCalls.find((call) => call[0] === 'saveSettings');
    const saveSettingsCallback = onCall?.[1] as (
      newState: unknown,
      oldState: unknown,
      context: unknown
    ) => Promise<void>;

    const state = {
      validationMessages: { enabled: '', name: '' }
    };
    await saveSettingsCallback(state, state, 'someOtherContext');
    expect(updateSpy).toHaveBeenCalled();
  });

  it('should refresh when onLoadSettings is triggered', async () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
    tab.displayLegacy();

    const updateSpy = vi.spyOn(tab, 'update');

    const onCalls: EventListenerEntry[] = vi.mocked(pluginSettingsComponent.on).mock.calls;
    const onCall = onCalls.find((call) => call[0] === 'loadSettings');
    const loadSettingsCallback = onCall?.[1] as (
      loadedState: unknown,
      isInitialLoad: boolean
    ) => Promise<void>;

    await loadSettingsCallback({}, false);
    expect(updateSpy).toHaveBeenCalled();
  });

  it('should handle bind with text component and shouldEmptyOnBlur', async () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
    tab.displayLegacy();

    let changeCallback: ((value: string) => Promise<void>) | undefined;
    const mockComponent = createTextBasedMockComponent();
    mockComponent.onChange = castTo<typeof mockComponent.onChange>(vi.fn((callback: (value: string) => Promise<void>) => {
      changeCallback = callback;
      return mockComponent;
    }));
    mockComponent.isEmpty = castTo<typeof mockComponent.isEmpty>(vi.fn(() => false));

    tab.bind({ propertyName: 'name', valueComponent: mockComponent });

    // Trigger onChange with value equal to default to set shouldEmptyOnBlur
    if (changeCallback) {
      await changeCallback('default');
    }
  });

  it('should handle saveSettingsDebounceTimeoutInMilliseconds getter', () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
    const timeout = tab['saveSettingsDebounceTimeoutInMilliseconds'];
    const EXPECTED_DEFAULT = 2000;
    expect(timeout).toBe(EXPECTED_DEFAULT);
  });

  it('should handle full bind with validatorElement and onChange triggering updateValidatorEl', async () => {
    vi.useFakeTimers();
    stubRequestAnimationFrame();
    try {
      const plugin = createMockPlugin(app);
      const pluginSettingsComponent = createMockSettingsComponent();
      const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
      tab.displayLegacy();

      const parentElement = createDiv();
      const validatorEl = createEl('input');
      parentElement.append(validatorEl);
      validatorEl.isActiveElement = vi.fn(() => false);

      let changeCallback: ((value: string) => Promise<void>) | undefined;
      const mockComponent = castTo<MockValueComponentWithValidator & ValueComponentWithChangeTracking<string>>({
        onChange: vi.fn((callback: (value: string) => Promise<void>) => {
          changeCallback = callback;
          return mockComponent;
        }),
        setValue: vi.fn(),
        validatorEl
      });

      tab.bind({ propertyName: 'name', valueComponent: mockComponent });

      // Trigger the initial debounced updateValidatorEl
      vi.advanceTimersByTime(200);
      await vi.runAllTimersAsync();

      if (changeCallback) {
        await changeCallback('newValue');
        // Advance debounce timer and run window.requestAnimationFrame
        vi.advanceTimersByTime(200);
        await vi.runAllTimersAsync();
      }
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('should handle validatorElement focus, blur and click events', async () => {
    vi.useFakeTimers();
    stubRequestAnimationFrame();
    try {
      const plugin = createMockPlugin(app);
      const pluginSettingsComponent = createMockSettingsComponent();
      const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
      tab.displayLegacy();

      const parentElement = createDiv();
      const validatorEl = createEl('input');
      parentElement.append(validatorEl);
      validatorEl.isActiveElement = vi.fn(() => false);

      const mockComponent = castTo<MockValueComponentWithValidator & ValueComponentWithChangeTracking<string>>({
        onChange: vi.fn(() => mockComponent),
        setValue: vi.fn(),
        validatorEl
      });

      tab.bind({ propertyName: 'name', valueComponent: mockComponent });

      // Trigger focus, blur, click events on validatorElement
      validatorEl.dispatchEvent(new Event('focus'));
      validatorEl.dispatchEvent(new Event('blur'));
      validatorEl.dispatchEvent(new Event('click'));

      vi.advanceTimersByTime(200);
      await vi.runAllTimersAsync();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('should handle updateValidatorEl with empty validation and shouldShowValidationMessage=false', async () => {
    vi.useFakeTimers();
    stubRequestAnimationFrame();
    try {
      const plugin = createMockPlugin(app);
      const pluginSettingsComponent = createMockSettingsComponent();
      const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
      tab.displayLegacy();

      const parentElement = createDiv();
      const validatorEl = createEl('input');
      parentElement.append(validatorEl);
      validatorEl.isActiveElement = vi.fn(() => false);

      let changeCallback: ((value: string) => Promise<void>) | undefined;
      const mockComponent = castTo<MockValueComponentWithValidator & ValueComponentWithChangeTracking<string>>({
        onChange: vi.fn((callback: (value: string) => Promise<void>) => {
          changeCallback = callback;
          return mockComponent;
        }),
        setValue: vi.fn(),
        validatorEl
      });

      vi.mocked(pluginSettingsComponent.setProperty).mockResolvedValue('Validation error');

      tab.bind({ propertyName: 'name', shouldShowValidationMessage: false, valueComponent: mockComponent });

      if (changeCallback) {
        await changeCallback('badValue');
        vi.advanceTimersByTime(200);
        await vi.runAllTimersAsync();
      }
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('should handle updateValidatorEl with shouldEmptyOnBlur and trigger shouldSkipOnChange', async () => {
    vi.useFakeTimers();
    stubRequestAnimationFrame();
    try {
      const plugin = createMockPlugin(app);
      const pluginSettingsComponent = createMockSettingsComponent();
      const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
      tab.displayLegacy();

      let changeCallback: ((value: string) => void) | undefined;
      const mockComponent = createTextBasedMockComponent();

      // Track onChange registrations
      mockComponent.onChange = castTo<typeof mockComponent.onChange>(vi.fn((callback: (value: string) => void) => {
        changeCallback = callback;
        return mockComponent;
      }));

      // isEmpty returns false so that the empty-on-blur path triggers
      mockComponent.isEmpty = castTo<typeof mockComponent.isEmpty>(vi.fn(() => false));

      // When empty() is called (inside updateValidatorEl), it should trigger onChange
      // which should hit the shouldSkipOnChange early return
      mockComponent.empty = castTo<typeof mockComponent.empty>(vi.fn(() => {
        // Simulate that empty() triggers onChange callback
        changeCallback?.('');
      }));

      tab.bind({ propertyName: 'name', valueComponent: mockComponent });

      // Trigger onChange with value equal to default to set shouldEmptyOnBlur=true
      if (changeCallback) {
        changeCallback('default');
        // Advance timers to trigger debounced updateValidatorEl
        // updateValidatorEl will see shouldEmptyOnBlur=true, call textBasedComponent.empty()
        // which triggers onChange with shouldSkipOnChange=true (lines 299-300)
        vi.advanceTimersByTime(200);
        await vi.runAllTimersAsync();
      }

      expect(mockComponent.empty).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('should handle updateValidatorEl with shouldRevertToDefaultValueOnBlur and empty text', async () => {
    vi.useFakeTimers();
    stubRequestAnimationFrame();
    try {
      const plugin = createMockPlugin(app);
      const pluginSettingsComponent = createMockSettingsComponent();
      const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
      tab.displayLegacy();

      let changeCallback: ((value: string) => Promise<void>) | undefined;
      const mockComponent = createTextBasedMockComponent();
      mockComponent.onChange = castTo<typeof mockComponent.onChange>(vi.fn((callback: (value: string) => Promise<void>) => {
        changeCallback = callback;
        return mockComponent;
      }));

      // isEmpty returns true during onChange (triggers shouldRevertToDefaultValueOnBlur)
      mockComponent.isEmpty = castTo<typeof mockComponent.isEmpty>(vi.fn(() => true));

      tab.bind({ propertyName: 'name', valueComponent: mockComponent });

      if (changeCallback) {
        await changeCallback('');
        // Advance timers to trigger debounced updateValidatorEl
        vi.advanceTimersByTime(200);
        await vi.runAllTimersAsync();

        // At this point updateValidatorEl should have been called with shouldRevertToDefaultValueOnBlur=true
        // and textBasedComponent.isEmpty() returns true, so it should call setValue with default
        expect(mockComponent.setValue).toHaveBeenCalled();
      }
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('should handle shouldRevertToDefaultValueOnBlur where isEmpty returns false in updateValidatorEl', async () => {
    vi.useFakeTimers();
    stubRequestAnimationFrame();
    try {
      const plugin = createMockPlugin(app);
      const pluginSettingsComponent = createMockSettingsComponent();
      const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
      tab.displayLegacy();

      let changeCallback: ((value: string) => Promise<void>) | undefined;
      const mockComponent = createTextBasedMockComponent();
      mockComponent.onChange = castTo<typeof mockComponent.onChange>(vi.fn((callback: (value: string) => Promise<void>) => {
        changeCallback = callback;
        return mockComponent;
      }));
      // During onChange: isEmpty=true at line 308 (triggers shouldRevertToDefaultValueOnBlur=true)
      // during updateValidatorEl: isEmpty=false at line 365 (user has typed something, skip setValue)
      let isInUpdateValidator = false;
      mockComponent.isEmpty = castTo<typeof mockComponent.isEmpty>(vi.fn(() => {
        return !isInUpdateValidator;
      }));

      tab.bind({ propertyName: 'name', valueComponent: mockComponent });

      if (changeCallback) {
        await changeCallback('');
        isInUpdateValidator = true;
        vi.advanceTimersByTime(200);
      }
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('should handle updateValidatorEl with validationMessage and shouldShowValidationMessage=true with tooltipEl', async () => {
    vi.useFakeTimers();
    // Mock window.requestAnimationFrame to execute callback synchronously
    stubRequestAnimationFrame();
    try {
      const plugin = createMockPlugin(app);
      const pluginSettingsComponent = createMockSettingsComponent();
      const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
      tab.displayLegacy();

      const parentElement = createDiv();
      const validatorEl = createEl('input');
      parentElement.append(validatorEl);
      validatorEl.isActiveElement = vi.fn(() => false);

      let changeCallback: ((value: string) => Promise<void>) | undefined;
      const mockComponent = castTo<MockValueComponentWithValidator & ValueComponentWithChangeTracking<string>>({
        onChange: vi.fn((callback: (value: string) => Promise<void>) => {
          changeCallback = callback;
          return mockComponent;
        }),
        setValue: vi.fn(),
        validatorEl
      });

      vi.mocked(pluginSettingsComponent.setProperty).mockResolvedValue('Error message');

      // shouldShowValidationMessage defaults to true
      tab.bind({ propertyName: 'name', valueComponent: mockComponent });

      if (changeCallback) {
        await changeCallback('badValue');
        vi.advanceTimersByTime(200);
      }
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('should handle updateValidatorEl when validatorElement is active (isActiveElement=true)', async () => {
    vi.useFakeTimers();
    stubRequestAnimationFrame();
    try {
      const plugin = createMockPlugin(app);
      const pluginSettingsComponent = createMockSettingsComponent();
      const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
      tab.displayLegacy();

      const parentElement = createDiv();
      const validatorEl = createEl('input');
      parentElement.append(validatorEl);
      // isActiveElement returns true - should NOT trigger empty/revert logic
      validatorEl.isActiveElement = vi.fn(() => true);

      let changeCallback: ((value: string) => Promise<void>) | undefined;
      const mockComponent = castTo<MockValueComponentWithValidator & ValueComponentWithChangeTracking<string>>({
        onChange: vi.fn((callback: (value: string) => Promise<void>) => {
          changeCallback = callback;
          return mockComponent;
        }),
        setValue: vi.fn(),
        validatorEl
      });

      tab.bind({ propertyName: 'name', valueComponent: mockComponent });

      if (changeCallback) {
        await changeCallback('value');
        vi.advanceTimersByTime(200);
      }
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('should handle shouldEmptyOnBlur when text IS already empty', async () => {
    vi.useFakeTimers();
    stubRequestAnimationFrame();
    try {
      const plugin = createMockPlugin(app);
      const pluginSettingsComponent = createMockSettingsComponent();
      const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
      tab.displayLegacy();

      let changeCallback: ((value: string) => Promise<void>) | undefined;
      const mockComponent = createTextBasedMockComponent();
      mockComponent.onChange = castTo<typeof mockComponent.onChange>(vi.fn((callback: (value: string) => Promise<void>) => {
        changeCallback = callback;
        return mockComponent;
      }));
      // During onChange: isEmpty=false at lines 308 and 323
      // (shouldRevertToDefaultValueOnBlur=false, and shouldEmptyOnBlur gets set to true)
      // during updateValidatorEl: isEmpty=true at line 358
      // (text IS already empty, so skip calling empty())
      let isInUpdateValidator = false;
      mockComponent.isEmpty = castTo<typeof mockComponent.isEmpty>(vi.fn(() => {
        // In updateValidatorEl context, return true (already empty)
        // in onChange context, return false (not empty)
        return isInUpdateValidator;
      }));

      tab.bind({ propertyName: 'name', valueComponent: mockComponent });

      if (changeCallback) {
        // Trigger with default value to set shouldEmptyOnBlur
        await changeCallback('default');
        // Before the debounced callback runs, mark that we're in updateValidator
        isInUpdateValidator = true;
        vi.advanceTimersByTime(200);
      }
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('should handle shouldShowValidationMessage=false with no validation message', async () => {
    vi.useFakeTimers();
    stubRequestAnimationFrame();
    try {
      const plugin = createMockPlugin(app);
      const pluginSettingsComponent = createMockSettingsComponent();
      const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
      tab.displayLegacy();

      const parentElement = createDiv();
      const validatorEl = createEl('input');
      parentElement.append(validatorEl);
      validatorEl.isActiveElement = vi.fn(() => false);

      let changeCallback: ((value: string) => Promise<void>) | undefined;
      const mockComponent = castTo<MockValueComponentWithValidator & ValueComponentWithChangeTracking<string>>({
        onChange: vi.fn((callback: (value: string) => Promise<void>) => {
          changeCallback = callback;
          return mockComponent;
        }),
        setValue: vi.fn(),
        validatorEl
      });

      // No validation error
      vi.mocked(pluginSettingsComponent.setProperty).mockResolvedValue('');

      tab.bind({ propertyName: 'name', shouldShowValidationMessage: false, valueComponent: mockComponent });

      if (changeCallback) {
        await changeCallback('validValue');
        vi.advanceTimersByTime(200);
      }
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('should handle missing validation message in settingsState (null coalescing)', () => {
    const plugin = createMockPlugin(app);
    // Create a special settings component where validationMessages has no 'name' key
    const listeners = new Map<string, GenericVoidFunction[]>();
    const pluginSettingsComponent = castTo<PluginSettingsComponentBase<TestSettings>>({
      defaultSettings: { enabled: false, name: 'default' },
      on: vi.fn((name: string, callback: GenericVoidFunction) => {
        const existing = listeners.get(name) ?? [];
        existing.push(callback);
        listeners.set(name, existing);
        return { asyncEvents: { offref: vi.fn() } };
      }),
      revalidate: vi.fn(() => Promise.resolve({ enabled: '', name: '' })),
      saveToFile: vi.fn(() => noopAsync()),
      setProperty: vi.fn(() => Promise.resolve('')),
      settingsState: {
        effectiveValues: { enabled: false, name: 'test' },
        inputValues: { enabled: false, name: 'test' },
        // Plain object without 'name' key to trigger the ?? '' fallback
        validationMessages: { enabled: '' } as Record<string, string>
      }
    });

    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
    tab.displayLegacy();

    const mockComponent = castTo<ValueComponentWithChangeTracking<string>>({
      onChange: vi.fn(() => mockComponent),
      setValue: vi.fn()
    });

    tab.bind({ propertyName: 'name', valueComponent: mockComponent });
  });

  it('should handle validationMessageChanged event in bind', async () => {
    vi.useFakeTimers();
    stubRequestAnimationFrame();
    try {
      const plugin = createMockPlugin(app);
      const pluginSettingsComponent = createMockSettingsComponent();
      const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
      tab.displayLegacy();

      const parentElement = createDiv();
      const validatorEl = createEl('input');
      parentElement.append(validatorEl);
      validatorEl.isActiveElement = vi.fn(() => false);

      const mockComponent = castTo<MockValueComponentWithValidator & ValueComponentWithChangeTracking<string>>({
        onChange: vi.fn(() => mockComponent),
        setValue: vi.fn(),
        validatorEl
      });

      tab.bind({ propertyName: 'name', valueComponent: mockComponent });

      // Trigger the validationMessageChanged event through updateValidations
      const saveSettingsCall = vi.mocked(pluginSettingsComponent.on).mock.calls.find(
        (call: unknown[]) => call[0] === 'saveSettings'
      );
      const saveSettingsCallback = saveSettingsCall?.[1] as (
        newState: unknown,
        oldState: unknown,
        context: unknown
      ) => Promise<void>;

      await saveSettingsCallback(
        { validationMessages: { enabled: '', name: 'Name is required' } },
        {},
        SAVE_TO_FILE_CONTEXT
      );

      vi.advanceTimersByTime(200);
      await vi.runAllTimersAsync();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

describe('PluginSettingsTabBase declarative settings', () => {
  it('should expose the consumer definitions to Obsidian', () => {
    const tab = createDeclarativeTab();
    const definition = tab.settingEx({ name: 'Name', render: noop });
    tab.definitionItems = [definition];

    expect(tab.getSettingDefinitions()).toEqual([definition]);
  });

  it('should build a heading group around the rows', () => {
    const tab = createDeclarativeTab();
    const row = tab.settingEx({ name: 'Name', render: noop });

    const group = tab.settingGroupEx({ heading: 'Heading', items: [row] });

    expect(group).toEqual({
      heading: 'Heading',
      items: [row],
      type: 'group'
    });
  });

  it('should fall back to the legacy path when the consumer provides no definitions', () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });

    expect(tab.getSettingDefinitions()).toEqual([]);
  });

  it('should adopt the setting into a SettingEx before rendering the row', () => {
    const tab = createDeclarativeTab();
    let renderedSetting: SettingEx | undefined;
    const definition = tab.settingEx({
      name: 'Name',
      render: (setting) => {
        renderedSetting = setting;
      }
    });

    const setting = createMockSetting();
    definition.render(setting, createMockSettingGroup());

    expect(renderedSetting).toBe(setting);
    expect(renderedSetting).toBeInstanceOf(SettingEx);
  });

  it('should pass the predicates through to the definition', () => {
    const tab = createDeclarativeTab();
    const definition = tab.settingEx({
      aliases: ['alias'],
      desc: 'Desc',
      disabled: isDisabled,
      name: 'Name',
      render: noop,
      visible: false
    });

    // Obsidian re-evaluates them on every render and on every `refreshDomState()`.
    expect(definition.disabled).toBe(isDisabled);
    expect(definition.visible).toBe(false);
    expect(definition.aliases).toEqual(['alias']);
    expect(definition.desc).toBe('Desc');
    expect(definition.name).toBe('Name');
  });

  it('should release the row subscriptions when Obsidian tears the row down', () => {
    const tab = createDeclarativeTab();
    const countLiveListeners = trackValidationListeners(tab);
    const consumerCleanup = vi.fn();

    const definition = tab.settingEx({
      name: 'Name',
      render: () => {
        tab.bind({ propertyName: 'name', valueComponent: createMockValueComponent() });
        return consumerCleanup;
      }
    });

    const cleanup = definition.render(createMockSetting(), createMockSettingGroup());
    expect(countLiveListeners()).toBe(1);

    if (typeof cleanup === 'function') {
      cleanup();
    }

    expect(consumerCleanup).toHaveBeenCalledOnce();
    expect(countLiveListeners()).toBe(0);
  });

  it('should release the row subscriptions even when the row returns no cleanup', () => {
    const tab = createDeclarativeTab();
    const countLiveListeners = trackValidationListeners(tab);

    const definition = tab.settingEx({
      name: 'Name',
      render: () => {
        tab.bind({ propertyName: 'name', valueComponent: createMockValueComponent() });
      }
    });

    const cleanup = definition.render(createMockSetting(), createMockSettingGroup());
    expect(countLiveListeners()).toBe(1);

    if (typeof cleanup === 'function') {
      cleanup();
    }

    expect(countLiveListeners()).toBe(0);
  });

  it('should keep every rendered row subscribed while it is on screen', () => {
    const tab = createDeclarativeTab();
    const countLiveListeners = trackValidationListeners(tab);

    const ROW_COUNT = 3;
    for (let index = 0; index < ROW_COUNT; index++) {
      const definition = tab.settingEx({
        name: `Name ${String(index)}`,
        render: () => {
          tab.bind({ propertyName: 'name', valueComponent: createMockValueComponent() });
        }
      });
      definition.render(createMockSetting(), createMockSettingGroup());
    }

    expect(countLiveListeners()).toBe(ROW_COUNT);
  });

  it('should read and write control values through the settings component', async () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });

    expect(tab.getControlValue('name')).toBe('test');

    await tab.setControlValue('name', 'newValue');

    expect(pluginSettingsComponent.setProperty).toHaveBeenCalledWith('name', 'newValue');
  });
});

describe('PluginSettingsTabBase render lifecycle', () => {
  it('should subscribe to the settings component only once across render cycles', () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });

    const RENDER_CYCLE_COUNT = 3;
    for (let index = 0; index < RENDER_CYCLE_COUNT; index++) {
      tab.displayLegacy();
    }

    // `loadSettings` and `saveSettings`, registered when the component loads — NOT once per render.
    const EXPECTED_SUBSCRIPTION_COUNT = 2;
    expect(pluginSettingsComponent.on).toHaveBeenCalledTimes(EXPECTED_SUBSCRIPTION_COUNT);
  });

  it('should not accumulate row subscriptions across render cycles', () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
    const countLiveListeners = trackValidationListeners(tab);

    const RENDER_CYCLE_COUNT = 3;
    for (let index = 0; index < RENDER_CYCLE_COUNT; index++) {
      tab.displayLegacy();
      tab.bind({ propertyName: 'name', valueComponent: createMockValueComponent() });
    }

    expect(countLiveListeners()).toBe(1);
  });

  it('should release the row subscriptions when the tab is hidden', () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });
    const countLiveListeners = trackValidationListeners(tab);

    tab.displayLegacy();
    tab.bind({ propertyName: 'name', valueComponent: createMockValueComponent() });
    expect(countLiveListeners()).toBe(1);

    tab.hide();

    expect(countLiveListeners()).toBe(0);
  });

  it('should resubscribe to the settings component when the tab is shown again', () => {
    const plugin = createMockPlugin(app);
    const pluginSettingsComponent = createMockSettingsComponent();
    const tab = new TestSettingsTab({ plugin, pluginSettingsComponent });

    tab.displayLegacy();
    tab.hide();
    tab.displayLegacy();

    const EXPECTED_SUBSCRIPTION_COUNT = 4;
    expect(pluginSettingsComponent.on).toHaveBeenCalledTimes(EXPECTED_SUBSCRIPTION_COUNT);
  });
});

describe('PluginSettingsTabBase settings management', () => {
  const EXPORTED_JSON = '{\n  "enabled": true,\n  "name": "exported"\n}';
  const NO_FINDINGS: PluginSettingsImportResult = { invalidPropertyNames: [], unknownPropertyNames: [] };

  interface ManagementFixture {
    readonly clickButton: (index: number) => void;
    readonly component: ManagementMocks;
    readonly readText: ReturnType<typeof vi.fn>;
    readonly setting: SettingApi;
    readonly tab: DeclarativeSettingsTab;
    readonly writeText: ReturnType<typeof vi.fn>;
  }

  interface SettingsImportEntryPoint {
    readonly importSettingsFromClipboard: () => Promise<void>;
  }

  interface ManagementMocks {
    readonly exportToJson: ReturnType<typeof vi.fn>;
    readonly getRecoveryCopies: ReturnType<typeof vi.fn>;
    readonly importFromJson: ReturnType<typeof vi.fn>;
    readonly resetToDefaults: ReturnType<typeof vi.fn>;
    readonly restoreRecoveryCopy: ReturnType<typeof vi.fn>;
  }

  interface RecoveryCopiesEntryPoint {
    readonly restoreRecoveryCopy: (copy: SettingsRecoveryCopy) => Promise<void>;
    readonly showRecoveryCopies: () => Promise<void>;
  }

  const VALID_COPY: SettingsRecoveryCopy = {
    id: '2026-11-20T10:00:00.000Z',
    keptAt: Date.UTC(2026, 10, 20, 10),
    path: 'data.json',
    rawText: '{"name":"kept"}',
    reason: SettingsRecoveryReason.LossyRewrite
  };

  const DAMAGED_COPY: SettingsRecoveryCopy = {
    id: '2026-11-19T10:00:00.000Z',
    keptAt: Date.UTC(2026, 10, 19, 10),
    path: 'data.json',
    rawText: '{"name":',
    reason: SettingsRecoveryReason.InvalidJson
  };

  function setUp(copies: readonly SettingsRecoveryCopy[] = []): ManagementFixture {
    const component: ManagementMocks = {
      exportToJson: vi.fn(() => Promise.resolve(EXPORTED_JSON)),
      getRecoveryCopies: vi.fn(() => Promise.resolve([...copies])),
      importFromJson: vi.fn(() => Promise.resolve(NO_FINDINGS)),
      resetToDefaults: vi.fn(() => noopAsync()),
      restoreRecoveryCopy: vi.fn(() => noopAsync())
    };
    const pluginSettingsComponent = createMockSettingsComponent(castTo<Partial<PluginSettingsComponentBase<TestSettings>>>(component));
    const tab = new DeclarativeSettingsTab({ plugin: createMockPlugin(app), pluginSettingsComponent });
    vi.spyOn(tab, 'refresh').mockImplementation(noop);
    const writeText = vi.fn(() => noopAsync());
    const readText = vi.fn(() => Promise.resolve(EXPORTED_JSON));
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { readText, writeText } });
    const setting = createMockSetting();
    const definition = tab.settingsManagementEx();
    definition.render(setting, createMockSettingGroup());
    return {
      clickButton: (index: number): void => {
        const button = setting.controlEl.querySelectorAll('button')[index];
        button?.click();
      },
      component,
      readText,
      setting,
      tab,
      writeText
    };
  }

  it('should describe the row for search and render three buttons into it', () => {
    const { setting, tab } = setUp();
    const definition = tab.settingsManagementEx();

    expect(definition.name).toBe('Manage settings');
    expect(definition.desc).toContain('Reset every setting to its default');
    expect([...setting.controlEl.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Reset to defaults',
      'Export to clipboard',
      'Import from clipboard'
    ]);
  });

  it('should reset to defaults after a confirmation, re-render and say so', async () => {
    const { clickButton, component, tab } = setUp();
    mockConfirm.mockResolvedValue(true);

    clickButton(0);

    await vi.waitFor(() => {
      expect(mockNotice).toHaveBeenCalledWith('The settings were reset to their defaults.');
    });
    expect(component.resetToDefaults).toHaveBeenCalledWith(SETTINGS_MANAGEMENT_CONTEXT);
    expect(tab.refresh).toHaveBeenCalled();
  });

  it('should leave the settings alone when the reset is not confirmed', async () => {
    const { clickButton, component } = setUp();
    mockConfirm.mockResolvedValue(false);

    clickButton(0);

    await vi.waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledOnce();
    });
    expect(component.resetToDefaults).not.toHaveBeenCalled();
  });

  it('should export the settings to the clipboard', async () => {
    const { clickButton, writeText } = setUp();

    clickButton(1);

    await vi.waitFor(() => {
      expect(mockNotice).toHaveBeenCalledWith('The settings were copied to the clipboard.');
    });
    expect(writeText).toHaveBeenCalledWith(EXPORTED_JSON);
  });

  it('should show the settings for copying by hand when the clipboard refuses them', async () => {
    const { clickButton, writeText } = setUp();
    writeText.mockRejectedValue(new Error('denied'));

    clickButton(1);

    await vi.waitFor(() => {
      expect(mockCopyTextManually).toHaveBeenCalledWith(expect.objectContaining({ text: EXPORTED_JSON, title: 'Copy the settings' }));
    });
    expect(mockNotice).not.toHaveBeenCalled();
  });

  it('should import the settings from the clipboard after a confirmation', async () => {
    const { clickButton, component, tab } = setUp();
    mockConfirm.mockResolvedValue(true);

    clickButton(2);

    await vi.waitFor(() => {
      expect(mockNotice).toHaveBeenCalledWith('The settings were imported.');
    });
    expect(component.importFromJson).toHaveBeenCalledWith(EXPORTED_JSON, SETTINGS_MANAGEMENT_CONTEXT);
    expect(tab.refresh).toHaveBeenCalled();
    expect(mockNotice).toHaveBeenCalledOnce();
  });

  it('should name the invalid and the unknown imported settings', async () => {
    const { clickButton, component } = setUp();
    mockConfirm.mockResolvedValue(true);
    component.importFromJson.mockResolvedValue({ invalidPropertyNames: ['name', 'enabled'], unknownPropertyNames: ['extra'] });

    clickButton(2);

    await vi.waitFor(() => {
      expect(mockNotice).toHaveBeenCalledTimes(3);
    });
    expect(mockNotice).toHaveBeenCalledWith('These imported settings are not valid, so their defaults are used until you fix them: name, enabled');
    expect(mockNotice).toHaveBeenCalledWith('These imported keys name no setting and were ignored: extra');
  });

  it('should ask for the settings to be pasted when the clipboard cannot be read', async () => {
    const { clickButton, component, readText } = setUp();
    mockConfirm.mockResolvedValue(true);
    readText.mockRejectedValue(new Error('denied'));
    mockPrompt.mockResolvedValue('{"name":"pasted"}');

    clickButton(2);

    await vi.waitFor(() => {
      expect(component.importFromJson).toHaveBeenCalledWith('{"name":"pasted"}', SETTINGS_MANAGEMENT_CONTEXT);
    });
    expect(mockPrompt).toHaveBeenCalledWith(expect.objectContaining({ title: 'Paste the settings JSON' }));
  });

  it('should import nothing when the paste is cancelled or the import is not confirmed', async () => {
    const { clickButton, component, readText } = setUp();
    readText.mockRejectedValue(new Error('denied'));
    mockPrompt.mockResolvedValue(null);
    mockConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    clickButton(2);
    await vi.waitFor(() => {
      expect(mockPrompt).toHaveBeenCalledOnce();
    });
    clickButton(2);
    await vi.waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledTimes(2);
    });

    expect(readText).toHaveBeenCalledOnce();
    expect(component.importFromJson).not.toHaveBeenCalled();
  });

  it('should say why a malformed import was refused', async () => {
    const { clickButton, component, tab } = setUp();
    mockConfirm.mockResolvedValue(true);
    component.importFromJson.mockRejectedValue(new PluginSettingsImportError('The text is not valid JSON.'));

    clickButton(2);

    await vi.waitFor(() => {
      expect(mockNotice).toHaveBeenCalledWith('The settings were not imported: The text is not valid JSON.');
    });
    expect(tab.refresh).not.toHaveBeenCalled();
  });

  it('should let any other import failure surface', async () => {
    const { component, tab } = setUp();
    mockConfirm.mockResolvedValue(true);
    const failure = new Error('disk full');
    component.importFromJson.mockRejectedValue(failure);

    await expect(castTo<SettingsImportEntryPoint>(tab).importSettingsFromClipboard()).rejects.toBe(failure);
    expect(mockNotice).not.toHaveBeenCalled();
  });

  it('should add no recovery copies button when this device keeps none', async () => {
    const { component, setting } = setUp();

    await vi.waitFor(() => {
      expect(component.getRecoveryCopies).toHaveBeenCalledOnce();
    });
    await waitForAllAsyncOperations();
    expect(setting.controlEl.querySelectorAll('button')).toHaveLength(3);
  });

  it('should add a recovery copies button naming how many copies are kept', async () => {
    const { setting } = setUp([VALID_COPY, DAMAGED_COPY]);

    await vi.waitFor(() => {
      expect(setting.controlEl.querySelectorAll('button')).toHaveLength(4);
    });
    expect(setting.controlEl.querySelectorAll('button')[3]?.textContent).toBe('Recovery copies (2)');
  });

  it('should restore the chosen copy after a confirmation, re-render and say so', async () => {
    const { clickButton, component, setting, tab } = setUp([VALID_COPY]);
    await vi.waitFor(() => {
      expect(setting.controlEl.querySelectorAll('button')).toHaveLength(4);
    });
    mockSelectSettingsRecoveryCopy.mockResolvedValue({ action: SettingsRecoveryCopyAction.Restore, copy: VALID_COPY });
    mockConfirm.mockResolvedValue(true);

    clickButton(3);

    await vi.waitFor(() => {
      expect(mockNotice).toHaveBeenCalledWith('The recovery copy was restored.');
    });
    expect(mockSelectSettingsRecoveryCopy).toHaveBeenCalledWith(expect.objectContaining({ copies: [VALID_COPY] }));
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('The settings in use are kept as a recovery copy first.') as unknown,
      title: 'Restore this copy?'
    }));
    expect(component.restoreRecoveryCopy).toHaveBeenCalledWith(VALID_COPY.id);
    expect(tab.refresh).toHaveBeenCalled();
  });

  it('should restore nothing when the modal is closed or the restore is not confirmed', async () => {
    const { component, tab } = setUp([VALID_COPY]);
    const entryPoint = castTo<RecoveryCopiesEntryPoint>(tab);
    mockSelectSettingsRecoveryCopy.mockResolvedValueOnce(null);
    await entryPoint.showRecoveryCopies();
    mockConfirm.mockResolvedValue(false);
    await entryPoint.restoreRecoveryCopy(VALID_COPY);

    expect(mockConfirm).toHaveBeenCalledOnce();
    expect(component.restoreRecoveryCopy).not.toHaveBeenCalled();
  });

  it('should say why a restore failed', async () => {
    const { component, tab } = setUp([VALID_COPY]);
    mockConfirm.mockResolvedValue(true);
    component.restoreRecoveryCopy.mockRejectedValue(new Error('No recovery copy "x" is kept on this device.'));

    await castTo<RecoveryCopiesEntryPoint>(tab).restoreRecoveryCopy(VALID_COPY);

    expect(mockNotice).toHaveBeenCalledWith('The recovery copy was not restored: No recovery copy "x" is kept on this device.');
    expect(tab.refresh).not.toHaveBeenCalled();
  });

  it('should let a restore failure that is not an error surface', async () => {
    const { component, tab } = setUp([VALID_COPY]);
    mockConfirm.mockResolvedValue(true);
    component.restoreRecoveryCopy.mockRejectedValue('odd');

    await expect(castTo<RecoveryCopiesEntryPoint>(tab).restoreRecoveryCopy(VALID_COPY)).rejects.toBe('odd');
  });

  it('should copy the text of a damaged copy to the clipboard', async () => {
    const { clickButton, setting, writeText } = setUp([DAMAGED_COPY]);
    await vi.waitFor(() => {
      expect(setting.controlEl.querySelectorAll('button')).toHaveLength(4);
    });
    mockSelectSettingsRecoveryCopy.mockResolvedValue({ action: SettingsRecoveryCopyAction.CopyText, copy: DAMAGED_COPY });

    clickButton(3);

    await vi.waitFor(() => {
      expect(mockNotice).toHaveBeenCalledWith(expect.stringContaining('The text of the recovery copy was copied to the clipboard.'));
    });
    expect(writeText).toHaveBeenCalledWith(DAMAGED_COPY.rawText);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('should show the text of a damaged copy for copying by hand when the clipboard refuses it', async () => {
    const { tab, writeText } = setUp([DAMAGED_COPY]);
    writeText.mockRejectedValue(new Error('denied'));
    mockSelectSettingsRecoveryCopy.mockResolvedValue({ action: SettingsRecoveryCopyAction.CopyText, copy: DAMAGED_COPY });

    await castTo<RecoveryCopiesEntryPoint>(tab).showRecoveryCopies();

    expect(mockCopyTextManually).toHaveBeenCalledWith(expect.objectContaining({ text: DAMAGED_COPY.rawText, title: 'Copy the recovery copy' }));
    expect(mockNotice).not.toHaveBeenCalled();
  });
});

function createDeclarativeTab(): DeclarativeSettingsTab {
  return new DeclarativeSettingsTab({
    plugin: createMockPlugin(app),
    pluginSettingsComponent: createMockSettingsComponent()
  });
}

function createMockSetting(): SettingApi {
  return Setting.create__(createDiv()).asOriginalType__();
}

function createMockSettingGroup(): SettingGroupApi {
  return SettingGroup.create__(createDiv()).asOriginalType__();
}

function createMockValueComponent(): ValueComponentWithChangeTracking<string> {
  const mockComponent = castTo<ValueComponentWithChangeTracking<string>>({
    onChange: vi.fn(() => mockComponent),
    setValue: vi.fn()
  });
  return mockComponent;
}

function createTextBasedMockComponent(): TextBasedMockComponentShape & ValueComponentWithChangeTracking<string> {
  const mockComponent = {
    empty: vi.fn(),
    isEmpty: vi.fn(() => false),
    onChange: vi.fn(() => mockComponent),
    setPlaceholderValue: vi.fn(() => mockComponent),
    setValue: vi.fn()
  };
  return castTo<TextBasedMockComponentShape & ValueComponentWithChangeTracking<string>>(mockComponent);
}

function isDisabled(): boolean {
  return true;
}

/**
 * Counts the `validationMessageChanged` listeners the tab currently holds.
 *
 * `bind` registers exactly one per row and ties it to the render lifecycle, so the count is the number of
 * rows still subscribed — which is what the leak regression is about. There is no public listener-count API,
 * so registrations are counted through the tab's own `on` and cancellations through `offref` on the event
 * source those registrations are released on.
 *
 * @param tab - The tab to track.
 * @returns A function returning the number of live listeners.
 */
function trackValidationListeners(tab: PluginSettingsTabBase<TestSettings>): () => number {
  // `validationMessageChanged` is the tab's only event, so every registration on the tab and every
  // cancellation on the source those registrations are released through belongs to it.
  const probeRef = tab.on('validationMessageChanged', noop);
  const { asyncEventSource } = probeRef;
  tab.offref(probeRef);

  const onSpy = vi.spyOn(tab, 'on');
  const offrefSpy = vi.spyOn(asyncEventSource, 'offref');

  return (): number => onSpy.mock.calls.length - offrefSpy.mock.calls.length;
}
