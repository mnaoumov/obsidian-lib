/**
 * @file
 *
 * Contains a component that records a hotkey.
 */

import type { Hotkey } from 'obsidian';

import {
  ExtraButtonComponent,
  ValueComponent
} from 'obsidian';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- We need to import `initPluginContext` to use it in the tsdocs.
import type { initPluginContext } from '../plugin/plugin-context.ts';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- We need to import `SettingEx` to use it in the tsdocs.
import type { SettingEx } from '../setting-ex.ts';
import type { ValueComponentWithChangeTracking } from './value-component-with-change-tracking.ts';

import { CssClass } from '../css-class.ts';
import {
  formatHotkey,
  getHotkeyFromKeyboardEvent
} from '../hotkey.ts';
import { t } from '../i18n/i18n.ts';
import { addPluginCssClasses } from '../plugin/plugin-context.ts';

/**
 * A component that records a hotkey: click the button, then press the key combination. Escape cancels the recording,
 * and the clear button sets the value to `null`.
 *
 * The value is a {@link Hotkey}, the shape Obsidian stores in `hotkeys.json`, so it can be handed to `Scope.register`.
 *
 * You can add this component using {@link SettingEx.addHotkey}.
 *
 * In order to add the styles for the component, use {@link initPluginContext} in your plugin's `onload()` function.
 *
 * Alternatively, you can copy styles from {@link https://unpkg.com/@mnaoumov/obsidian-lib/dist/styles.css}.
 */
export class HotkeyComponent extends ValueComponent<Hotkey | null> implements ValueComponentWithChangeTracking<Hotkey | null> {
  /**
   * The button that shows the hotkey and starts the recording.
   */
  public readonly buttonEl: HTMLButtonElement;

  /**
   * The button that clears the hotkey.
   */
  public readonly clearButton: ExtraButtonComponent;

  /**
   * Whether the component is waiting for a key press.
   *
   * @returns Whether it is recording.
   */
  public get isRecording(): boolean {
    return this._isRecording;
  }

  private _isRecording = false;
  private changeCallback?: (newValue: Hotkey | null) => void;
  private value: Hotkey | null = null;

  /**
   * Creates a new hotkey component.
   *
   * @param containerEl - The container element.
   */
  public constructor(containerEl: HTMLElement) {
    super();
    addPluginCssClasses(containerEl, CssClass.HotkeyComponent);
    this.buttonEl = containerEl.createEl('button');
    this.buttonEl.addEventListener('click', this.startRecording.bind(this));
    this.buttonEl.addEventListener('keydown', this.onKeyDown.bind(this));
    this.buttonEl.addEventListener('blur', this.stopRecording.bind(this));
    this.clearButton = new ExtraButtonComponent(containerEl)
      .setIcon('x')
      .setTooltip(t(($) => $.obsidianLib.hotkey.clear))
      .onClick(() => {
        this.setValueAndNotify(null);
      });
    this.render();
  }

  /**
   * Gets the hotkey.
   *
   * @returns The hotkey, or `null` when none is set.
   */
  public override getValue(): Hotkey | null {
    return this.value;
  }

  /**
   * Sets the callback to be called when the user records or clears a hotkey.
   *
   * @param callback - The callback.
   * @returns The component.
   */
  public onChange(callback: (newValue: Hotkey | null) => void): this {
    this.changeCallback = callback;
    return this;
  }

  /**
   * Sets the disabled state of the component.
   *
   * @param isDisabled - The disabled state.
   * @returns The component.
   */
  public override setDisabled(isDisabled: boolean): this {
    super.setDisabled(isDisabled);
    this.buttonEl.disabled = isDisabled;
    this.clearButton.setDisabled(isDisabled);
    if (isDisabled) {
      this.stopRecording();
    }
    return this;
  }

  /**
   * Sets the hotkey.
   *
   * @param value - The hotkey, or `null` to clear it.
   * @returns The component.
   */
  public override setValue(value: Hotkey | null): this {
    this.value = value;
    this.render();
    return this;
  }

  /**
   * Starts waiting for a key press.
   */
  public startRecording(): void {
    if (this.disabled) {
      return;
    }
    this._isRecording = true;
    this.render();
  }

  /**
   * Stops waiting for a key press, keeping the current hotkey.
   */
  public stopRecording(): void {
    this._isRecording = false;
    this.render();
  }

  private onKeyDown($event: KeyboardEvent): void {
    if (!this._isRecording) {
      return;
    }
    $event.preventDefault();
    $event.stopPropagation();
    if ($event.key === 'Escape') {
      this.stopRecording();
      return;
    }
    const hotkey = getHotkeyFromKeyboardEvent({ event: $event });
    if (!hotkey) {
      return;
    }
    this._isRecording = false;
    this.setValueAndNotify(hotkey);
  }

  private render(): void {
    if (this._isRecording) {
      this.buttonEl.setText(t(($) => $.obsidianLib.hotkey.pressHotkey));
    } else if (this.value) {
      this.buttonEl.setText(formatHotkey({ hotkey: this.value }));
    } else {
      this.buttonEl.setText(t(($) => $.obsidianLib.hotkey.notSet));
    }
    this.buttonEl.toggleClass(CssClass.IsActive, this._isRecording);
    this.buttonEl.toggleClass(CssClass.IsPlaceholder, !this._isRecording && !this.value);
  }

  private setValueAndNotify(value: Hotkey | null): void {
    this.setValue(value);
    this.changeCallback?.(value);
  }
}
