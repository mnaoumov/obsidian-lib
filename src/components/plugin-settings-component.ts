/**
 * @file
 *
 * Component that manages plugin settings: data, persistence, validation, and events.
 *
 * This is the single public-facing settings API for plugin authors.
 * All settings logic (load, save, validate, transform, clone) is handled directly
 * by this component — no separate manager class is needed.
 */

import type {
  AsyncEventRef,
  AsyncEventSource,
  CallbackArguments
} from '@mnaoumov/typescript-lib/async-events';
import type { Transformer } from '@mnaoumov/typescript-lib/transformers/transformer';
import type {
  MaybeReturn,
  StringKeys
} from '@mnaoumov/typescript-lib/type';
import type { GenericObject } from '@mnaoumov/typescript-lib/type-guards';
import type {
  Constructor,
  Promisable,
  ReadonlyDeep
} from 'type-fest';

import { AsyncEvents } from '@mnaoumov/typescript-lib/async-events';
import {
  noop,
  noopAsync
} from '@mnaoumov/typescript-lib/function';
import {
  castTo,
  getAllKeys,
  isDeepEqual
} from '@mnaoumov/typescript-lib/object-utils';
import { DateTransformer } from '@mnaoumov/typescript-lib/transformers/date-transformer';
import { GroupTransformer } from '@mnaoumov/typescript-lib/transformers/group-transformer';
import { MapTransformer } from '@mnaoumov/typescript-lib/transformers/map-transformer';
import { SetTransformer } from '@mnaoumov/typescript-lib/transformers/set-transformer';
import { SkipPrivatePropertyTransformer } from '@mnaoumov/typescript-lib/transformers/skip-private-property-transformer';
import { TwoWayMapTransformer } from '@mnaoumov/typescript-lib/transformers/two-way-map-transformer';
import { ValueWrapper } from '@mnaoumov/typescript-lib/value-wrapper';

import type { DataHandler } from '../data-handler.ts';
import type { PluginEventSource } from '../plugin/plugin-event-source.ts';
import type { SettingsRecoveryCopy } from '../settings-recovery.ts';

import { PluginDataParseError } from '../data-handler.ts';
import { getObsidianLibDebugger } from '../debug.ts';
import { SettingsRecoveryReason } from '../settings-recovery.ts';
import { DurationTransformer } from '../transformers/duration-transformer.ts';
import { registerAsyncEvent } from './async-events-component.ts';
import { ComponentEx } from './component-ex.ts';

/**
 * The indentation Obsidian's `Vault.writeJson` uses for `data.json`, so a recovery copy reads like the file did.
 */
const JSON_INDENT = 2;

const defaultTransformer = new GroupTransformer([
  new SkipPrivatePropertyTransformer(),
  new DateTransformer(),
  new DurationTransformer(),
  new MapTransformer(),
  new SetTransformer(),
  new TwoWayMapTransformer()
]);

/**
 * Constructor parameters for {@link PluginSettingsComponentBase}.
 *
 * @typeParam PluginSettings - The type of the plugin settings.
 */
export interface PluginSettingsComponentBaseConstructorParams<PluginSettings> {
  /**
   * The data handler for the plugin.
   */
  readonly dataHandler: DataHandler;

  /**
   * The plugin events.
   */
  readonly pluginEventSource: PluginEventSource;

  /**
   * The plugin settings class.
   */
  readonly pluginSettingsClass: Constructor<PluginSettings, []>;
}

/**
 * Parameters for {@link PluginSettingsComponentBase.onSaveSettings}.
 *
 * @typeParam PluginSettings - The type of the plugin settings.
 */
export interface PluginSettingsComponentBaseOnSaveSettingsParams<PluginSettings extends object> {
  /**
   * The save context.
   */
  readonly context: unknown;

  /**
   * The new settings state.
   */
  readonly newState: ReadonlyPluginSettingsState<PluginSettings>;

  /**
   * The old settings state.
   */
  readonly oldState: ReadonlyPluginSettingsState<PluginSettings>;
}

/**
 * A snapshot of plugin settings state, including raw input values, effective (validated) values,
 * and per-property validation messages.
 *
 * @typeParam PluginSettings - The type of the plugin settings.
 */
export interface PluginSettingsState<PluginSettings extends object> {
  /**
   * The effective settings values used by the plugin. Invalid properties are replaced with defaults.
   */
  readonly effectiveValues: PluginSettings;

  /**
   * The raw input values as entered by the user. May contain invalid values.
   */
  readonly inputValues: PluginSettings;

  /**
   * Per-property validation messages. Empty string means valid.
   */
  readonly validationMessages: Record<StringKeys<PluginSettings>, string>;
}

/**
 * Readonly version of {@link PluginSettings}.
 *
 * @typeParam PluginSettings - The type of the plugin settings.
 */
export type ReadonlyPluginSettings<PluginSettings extends object> = ReadonlyDeep<PluginSettings>;

/**
 * Readonly version of {@link PluginSettingsState} for use in event callbacks and public getters.
 *
 * @typeParam PluginSettings - The type of the plugin settings.
 */
export type ReadonlyPluginSettingsState<PluginSettings extends object> = ReadonlyDeep<PluginSettingsState<PluginSettings>>;

/**
 * A validator function for a settings property.
 *
 * @typeParam PluginSettings - The plugin settings type.
 * @typeParam PropertyName - The property name.
 */
export type SettingsValidator<PluginSettings extends object, PropertyName extends StringKeys<PluginSettings> = StringKeys<PluginSettings>> = (
  value: PluginSettings[PropertyName],
  settings: PluginSettings
) => Promisable<MaybeReturn<null | string>>;

interface PluginSettingsComponentBaseEventMap<PluginSettings extends object> {
  readonly loadSettings: [
    loadedState: ReadonlyPluginSettingsState<PluginSettings>,
    isInitialLoad: boolean
  ];
  readonly saveSettings: [
    newState: ReadonlyPluginSettingsState<PluginSettings>,
    oldState: ReadonlyPluginSettingsState<PluginSettings>,
    context: unknown
  ];
}

/**
 * Parameters for {@link PluginSettingsComponentBase.setPropertyImpl}.
 *
 * @typeParam PluginSettings - The type of the plugin settings.
 */
interface PluginSettingsComponentBaseSetPropertyImplParams<PluginSettings extends object> {
  /**
   * The name of the property to set.
   */
  readonly propertyName: PropertyNames<PluginSettings>;

  /**
   * The validation message. Empty or unset means valid.
   */
  readonly validationMessage?: string | undefined;

  /**
   * The value to set.
   */
  readonly value: PropertyValues<PluginSettings>;
}

type PropertyNames<PluginSettings extends object> = StringKeys<PluginSettings>;

type PropertyValues<PluginSettings extends object> = PluginSettings[PropertyNames<PluginSettings>];

type ValidationResult<PluginSettings extends object> = Partial<Record<StringKeys<PluginSettings>, string>>;

/**
 * Base class for plugin settings components.
 *
 * Manages settings data, persistence, validation, and events.
 * Plugin authors extend this class and pass their settings class as
 * {@link PluginSettingsComponentBaseConstructorParams.pluginSettingsClass}, whose default-constructed instance supplies the defaults.
 *
 * @typeParam PluginSettings - The plugin settings type.
 */
// eslint-disable-next-line obsidian-dev-toolkit/require-component-suffix -- Non-abstract base class; consumers extend it.
export class PluginSettingsComponentBase<PluginSettings extends object> extends ComponentEx implements AsyncEventSource<PluginSettingsComponentBaseEventMap<PluginSettings>> {
  /**
   * Gets the readonly default settings.
   *
   * @returns The default settings (as a readonly object).
   */
  public readonly defaultSettings: ReadonlyDeep<PluginSettings>;

  /**
   * Gets the readonly effective settings (validated, with defaults substituted for invalid values).
   *
   * @returns The readonly effective settings.
   */
  public get settings(): ReadonlyDeep<PluginSettings> {
    return this.settingsState.effectiveValues;
  }

  /**
   * Gets the current settings state snapshot.
   *
   * @returns The current settings state.
   */
  public get settingsState(): ReadonlyPluginSettingsState<PluginSettings> {
    return this.currentState as ReadonlyPluginSettingsState<PluginSettings>;
  }

  /**
   * The data handler used to load and save the plugin settings.
   */
  protected readonly dataHandler: DataHandler;
  /**
   * The plugin event source the component listens to for external settings changes.
   */
  protected readonly pluginEventSource: PluginEventSource;

  /**
   * The plugin settings class used to construct settings instances.
   */
  protected readonly pluginSettingsClass: Constructor<PluginSettings, []>;
  private readonly asyncEvents = new AsyncEvents<PluginSettingsComponentBaseEventMap<PluginSettings>>();
  private currentState: PluginSettingsState<PluginSettings>;

  private isLoadedFromFile = false;

  private lastSavedState: PluginSettingsState<PluginSettings>;

  private readonly legacySettingsConverters: ((record: GenericObject) => void)[] = [];
  private readonly loadedFromFileResolvers: (() => void)[] = [];
  private readonly propertyNames: PropertyNames<PluginSettings>[];

  private readonly validators = new Map<PropertyNames<PluginSettings>, SettingsValidator<PluginSettings>>();

  /**
   * Creates a new plugin settings component.
   *
   * @param params - The constructor parameters.
   */
  public constructor(params: PluginSettingsComponentBaseConstructorParams<PluginSettings>) {
    super();
    this.dataHandler = params.dataHandler;
    this.pluginSettingsClass = params.pluginSettingsClass;
    this.pluginEventSource = params.pluginEventSource;

    this.defaultSettings = new this.pluginSettingsClass() as ReadonlyDeep<PluginSettings>;
    this.currentState = this.createDefaultState();
    this.lastSavedState = this.createDefaultState();
    this.propertyNames = getAllKeys(this.currentState.inputValues);
    this.registerValidators();
    this.registerLegacySettingsConverters();
  }

  /**
   * Edits the plugin settings and saves them.
   *
   * @param settingsEditor - The editor.
   * @param context - The context.
   * @returns A {@link Promise} that resolves when the settings are saved.
   */
  public async editAndSave(settingsEditor: (settings: PluginSettings) => Promisable<void>, context?: unknown): Promise<void> {
    this.ensureLoaded();
    await this.edit(settingsEditor);
    await this.saveToFile(context);
  }

  /**
   * Ensures the settings are safe.
   *
   * It runs validation for each property and sets the default value if the validation fails.
   *
   * @param settings - The settings.
   * @returns A {@link Promise} that resolves when the settings are safe.
   */
  public async ensureSafe(settings: PluginSettings): Promise<void> {
    const validationResult = await this.validate(settings);
    const defaults = this.defaultSettings as PluginSettings;
    for (const propertyName of this.propertyNames) {
      // eslint-disable-next-line unicorn/no-computed-property-existence-check -- This tests whether a validation message is non-empty, not whether the key exists.
      if (validationResult[propertyName]) {
        settings[propertyName] = defaults[propertyName];
      }
    }
  }

  /**
   * Lists the recovery copies of `data.json` kept on this device: copies of a file that did not parse, and of a file
   * whose stored values a first save would have dropped or changed.
   *
   * @returns The copies, newest first; none when the data handler keeps no recovery copies.
   */
  public async getRecoveryCopies(): Promise<SettingsRecoveryCopy[]> {
    return await this.dataHandler.recoveryStore?.list() ?? [];
  }

  /**
   * Gets a safe copy of the settings.
   *
   * @param settings - The settings.
   * @returns A {@link Promise} that resolves to the safe copy of the settings.
   */
  public async getSafeCopy(settings: PluginSettings): Promise<PluginSettings> {
    const safeSettings = await this.cloneSettings(settings);
    await this.ensureSafe(safeSettings);
    return safeSettings;
  }

  /**
   * Loads the plugin settings from the file.
   *
   * @param isInitialLoad - Whether the settings are being loaded for the first time. Only the initial load
   * writes the normalized record back to `data.json`; a reload applies it in memory only.
   * @returns A {@link Promise} that resolves when the settings are loaded.
   */
  public async loadFromFile(isInitialLoad: boolean): Promise<void> {
    this.ensureLoaded();
    let data: unknown;
    try {
      data = await this.dataHandler.loadData();
    } catch (error) {
      // A `data.json` that does not parse is NOT an empty record: reading it as one would save the defaults over the
      // user's settings. The file is left untouched either way. With a recovery copy kept, the initial load runs on
      // the defaults in memory and a reload keeps the settings already in memory, and nothing is written until the
      // user changes a setting. Without a copy the load fails, so nothing can ever be saved over the only copy.
      if (!(error instanceof PluginDataParseError) || error.recoveryCopy === null) {
        throw error;
      }
      if (isInitialLoad) {
        this.lastSavedState = this.createDefaultState();
        this.currentState = this.createDefaultState();
      }
      this.markLoadedFromFile();
      if (isInitialLoad) {
        await this.asyncEvents.triggerAsync('loadSettings', this.currentState as ReadonlyPluginSettingsState<PluginSettings>, isInitialLoad);
      }
      return;
    }
    // Taken before anything below can mutate the record: what the file held, for a recovery copy.
    const originalJson = JSON.stringify(data, undefined, JSON_INDENT);
    this.lastSavedState = this.createDefaultState();
    this.currentState = this.createDefaultState();

    try {
      if (data !== undefined && data !== null && typeof data !== 'object') {
        console.error(`Invalid settings from data.json. Expected Object, got: ${typeof data}`);
        return;
      }

      // Nothing stored is read as an empty record rather than skipped, so the save below writes the full
      // default record. Without it a user who never changed a setting has no `data.json` at all, looks
      // exactly like a fresh install, and silently picks up every default a later release changes.
      const rawRecord = (data ?? {}) as GenericObject;
      const parsedSettings = await this.rawRecordToSettings(rawRecord);
      const validationResult = await this.validate(parsedSettings);

      for (const propertyName of this.propertyNames) {
        this.setPropertyImpl({
          propertyName,
          validationMessage: validationResult[propertyName],
          value: parsedSettings[propertyName]
        });
      }

      this.lastSavedState = await this.cloneState(this.currentState);

      // A component that knows no property names cannot normalize anything: `settingsToRawRecord()` can
      // only ever return `{}`, so the save below would not rewrite `data.json` -- it would empty it.
      // `PluginBase` adds a placeholder `PluginSettingsComponentBase<object>` before `onloadImpl()` swaps
      // in the plugin's own component, and that placeholder is exactly this case: it read every real
      // setting, kept none of them, and saved the difference back over the file.
      //
      // A reload caused by an external change (a sync tool, another device) applies the normalized
      // settings in memory and never writes them back. Two synced devices whose normalization differs
      // (different plugin versions, or any normalization that is not a fixed point) would otherwise
      // rewrite each other's `data.json` on every reload, and the sync tool would carry each rewrite
      // back, forever (`obsidian-custom-attachment-location` #102). The initial load still writes:
      // the default record and the legacy migrations depend on it.
      if (this.propertyNames.length === 0 || !isInitialLoad) {
        return;
      }

      const newRecord = await this.settingsToRawRecord(this.currentState.inputValues);

      if (!isDeepEqual(newRecord, data) && await this.keepCopyBeforeLossyRewrite(originalJson, newRecord)) {
        await this.saveToFileImpl();
      }
    } finally {
      this.markLoadedFromFile();
      await this.asyncEvents.triggerAsync('loadSettings', this.currentState as ReadonlyPluginSettingsState<PluginSettings>, isInitialLoad);
    }
  }

  /**
   * Remove an event listener.
   *
   * @typeParam EventName - The name of the event.
   * @typeParam Arguments - The types of the arguments the event callback accepts.
   * @param name - The name of the event.
   * @param callback - The callback to remove.
   */
  public off<
    EventName extends StringKeys<PluginSettingsComponentBaseEventMap<PluginSettings>>,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- We need to use the dummy parameter to get type inference.
    Arguments extends CallbackArguments<PluginSettingsComponentBaseEventMap<PluginSettings>, EventName>
  >(name: EventName, callback: (...$arguments: Arguments) => Promisable<void>): void {
    this.asyncEvents.off(name, callback);
  }

  /**
   * Remove an event listener by reference.
   *
   * @param eventRef - The reference to the event listener.
   */
  public offref(eventRef: AsyncEventRef): void {
    this.asyncEvents.offref(eventRef);
  }

  /**
   * Add an event listener.
   *
   * @typeParam EventName - The name of the event.
   * @typeParam Arguments - The types of the arguments the event callback accepts.
   * @param name - The name of the event.
   * @param callback - The callback to call when the event is triggered.
   * @param thisArgument - The context passed as `this` to the `callback`.
   * @returns A reference to the event listener.
   *
   * @remarks Not refactored to parameter-object pattern, to keep the parity with {@link obsidian#Events#on} (or once, correspondingly).
   */
  public on<
    EventName extends StringKeys<PluginSettingsComponentBaseEventMap<PluginSettings>>,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- We need to use the dummy parameter to get type inference.
    Arguments extends CallbackArguments<PluginSettingsComponentBaseEventMap<PluginSettings>, EventName>
  >(name: EventName, callback: (...$arguments: Arguments) => Promisable<void>, thisArgument?: unknown): AsyncEventRef {
    return this.asyncEvents.on(name, callback, thisArgument);
  }

  /**
   * Trigger an event, executing all the listeners in order even if some of them throw an error.
   *
   * Add an event listener that will be called only once.
   *
   * @typeParam EventName - The name of the event.
   * @typeParam Arguments - The types of the arguments the event callback accepts.
   * @param name - The name of the event.
   * @param callback - The callback to call when the event is triggered.
   * @param thisArgument - The context passed as `this` to the `callback`.
   * @returns A reference to the event listener.
   *
   * @remarks Not refactored to parameter-object pattern, to keep the parity with {@link obsidian#Events#on} (or once, correspondingly).
   */
  public once<
    EventName extends StringKeys<PluginSettingsComponentBaseEventMap<PluginSettings>>,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- We need to use the dummy parameter to get type inference.
    Arguments extends CallbackArguments<PluginSettingsComponentBaseEventMap<PluginSettings>, EventName>
  >(name: EventName, callback: (...$arguments: Arguments) => Promisable<void>, thisArgument?: unknown): AsyncEventRef {
    return this.asyncEvents.once(name, callback, thisArgument);
  }

  /**
   * Called when the external settings change.
   *
   * @returns A {@link Promise} that resolves when the settings are reloaded.
   */
  public async onExternalSettingsChange(): Promise<void> {
    this.ensureLoaded();
    await this.loadFromFile(false);
  }

  /**
   * Loads settings from file and registers event handlers.
   */
  public override async onloadAsync(): Promise<void> {
    registerAsyncEvent(this, this.on('loadSettings', this.onLoadSettings.bind(this)));
    registerAsyncEvent(this, this.on('saveSettings', (newState, oldState, context) => this.onSaveSettings({ context, newState, oldState })));
    registerAsyncEvent(this, this.pluginEventSource.on('externalSettingsChange', this.onExternalSettingsChange.bind(this)));
    await this.loadFromFile(true);
  }

  /**
   * Registers a legacy settings converter.
   *
   * @typeParam LegacySettings - The legacy settings class.
   * @param legacySettingsClass - The legacy settings class.
   * @param converter - The converter.
   */
  public registerLegacySettingsConverter<LegacySettings extends object>(
    legacySettingsClass: new () => LegacySettings,
    converter: (legacySettings: Partial<LegacySettings> & Partial<PluginSettings>) => void
  ): void {
    const thisWrapper = ValueWrapper.of(this);
    this.legacySettingsConverters.push(legacySettingsConverter);

    function legacySettingsConverter(record: GenericObject): void {
      const legacySettingsKeys = new Set<string>(Object.keys(new legacySettingsClass()));
      const pluginSettingKeys = new Set<string>(thisWrapper.value.propertyNames);
      const legacySettings = record as Partial<LegacySettings> & Partial<PluginSettings>;
      converter(legacySettings);
      for (const key of Object.keys(legacySettings)) {
        if (pluginSettingKeys.has(key) || !legacySettingsKeys.has(key)) {
          continue;
        }

        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- We have no other way to delete the property.
        delete record[key];
      }
    }
  }

  /**
   * Registers a validator for a property.
   *
   * @typeParam PropertyName - The name of the settings property.
   * @param propertyName - The name of the property.
   * @param validator - The validator.
   */
  public registerValidator<PropertyName extends PropertyNames<PluginSettings>>(
    propertyName: PropertyName,
    validator: SettingsValidator<PluginSettings, PropertyName>
  ): void {
    this.validators.set(propertyName, validator as SettingsValidator<PluginSettings>);
  }

  /**
   * Restores a recovery copy of `data.json` kept on this device: writes its record back to the file and reloads the
   * settings from it.
   *
   * The settings in use are kept as a recovery copy of their own first, so a restore loses nothing either.
   *
   * @param id - The id of the copy, from {@link getRecoveryCopies}.
   * @returns A {@link Promise} that resolves when the restored settings are loaded.
   * @throws If the data handler keeps no recovery copies, no copy has that id, or the copy is not valid JSON (a copy
   * of an unparseable file has to be repaired by hand first).
   */
  public async restoreRecoveryCopy(id: string): Promise<void> {
    this.ensureLoaded();
    const recoveryStore = this.dataHandler.recoveryStore;
    if (!recoveryStore) {
      throw new Error('The data handler keeps no recovery copies.');
    }
    const copies = await recoveryStore.list();
    const copy = copies.find((candidate) => candidate.id === id);
    if (!copy) {
      throw new Error(`No recovery copy "${id}" is kept on this device.`);
    }

    let data: unknown;
    try {
      data = JSON.parse(copy.rawText);
    } catch (error) {
      throw new Error(`Recovery copy "${id}" is not valid JSON, so it cannot be restored as it is.`, { cause: error });
    }

    const currentRecord = await this.settingsToRawRecord(this.currentState.inputValues);
    await recoveryStore.keep({
      path: copy.path,
      rawText: JSON.stringify(currentRecord, undefined, JSON_INDENT),
      reason: SettingsRecoveryReason.LossyRewrite
    });
    await this.dataHandler.saveData(data);
    await this.loadFromFile(false);
  }

  /**
   * Revalidates the settings.
   *
   * @returns The validation messages.
   */
  public async revalidate(): Promise<Record<PropertyNames<PluginSettings>, string>> {
    this.ensureLoaded();
    await this.edit(noop);
    return this.currentState.validationMessages;
  }

  /**
   * Saves the new plugin settings.
   *
   * @param context - The context of the save to file operation.
   * @returns A {@link Promise} that resolves when the settings are saved.
   */
  public async saveToFile(context?: unknown): Promise<void> {
    this.ensureLoaded();
    if (isDeepEqual(this.lastSavedState.inputValues, this.currentState.inputValues)) {
      return;
    }

    try {
      await this.saveToFileImpl();
    } catch (error) {
      // A refused save (an oversized `data.json`, see `PluginDataHandler`) wrote nothing, so the file still holds
      // the last saved settings. Put memory back to match it: otherwise every later save would carry the rejected
      // edit again and fail the same way, and the plugin would run on settings that exist nowhere on disk.
      this.currentState = await this.cloneState(this.lastSavedState);
      throw error;
    }
    await this.asyncEvents.triggerAsync(
      'saveSettings',
      this.currentState as ReadonlyPluginSettingsState<PluginSettings>,
      this.lastSavedState as ReadonlyPluginSettingsState<PluginSettings>,
      context
    );
    this.lastSavedState = await this.cloneState(this.currentState);
  }

  /**
   * Sets the value of a property.
   *
   * @typeParam PropertyName - The name of the property.
   * @param propertyName - The name of the property.
   * @param value - The value to set.
   * @returns A {@link Promise} that resolves to the validation message.
   */
  public async setProperty<PropertyName extends PropertyNames<PluginSettings>>(
    propertyName: PropertyName,
    value: PluginSettings[PropertyName]
  ): Promise<string> {
    this.ensureLoaded();
    await this.edit((settings) => {
      settings[propertyName] = value;
    });
    return this.currentState.validationMessages[propertyName];
  }

  /**
   * Validates the settings.
   *
   * @param settings - The settings.
   * @returns A {@link Promise} that resolves to the validation result.
   */
  public async validate(settings: PluginSettings): Promise<ValidationResult<PluginSettings>> {
    const result: ValidationResult<PluginSettings> = {};
    for (const [propertyName, validator] of this.validators) {
      const validationMessage = await validator(settings[propertyName], settings);
      if (validationMessage) {
        result[propertyName] = validationMessage;
      }
    }

    return result;
  }

  /**
   * Waits until the settings have been read from `data.json` at least once.
   *
   * Anything that reads a setting from outside this component has to wait for this, because until the first
   * {@link loadFromFile} completes {@link settings} still holds the DEFAULTS — reading it earlier answers
   * with a default rather than with what the user actually stored. That window is easy to miss, since it is
   * empty on a cold start (the workspace layout is not ready yet, so nothing has run) but wide open on a
   * runtime enable from the Community Plugins tab or a re-enable after an update, where a layout-ready
   * handler fires immediately while this component's own async load is still in flight.
   *
   * Resolves immediately once the settings have loaded, so a caller that arrives late is not stranded
   * waiting for an event that has already been raised. Later reloads (an external `data.json` change) do
   * not reset it — the question it answers is whether the settings have EVER been read, not whether the
   * most recent read has finished.
   *
   * @returns A {@link Promise} that resolves once the settings have been loaded from the file.
   */
  public whenLoadedFromFile(): Promise<void> {
    return this.isLoadedFromFile
      ? noopAsync()
      : new Promise<void>((resolve) => {
        this.loadedFromFileResolvers.push(resolve);
      });
  }

  /**
   * Gets the transformer.
   *
   * @returns The transformer.
   */
  protected getTransformer(): Transformer {
    return defaultTransformer;
  }

  /**
   * Called when the plugin settings record is loaded from disk.
   *
   * @param record - The record.
   */
  protected async onLoadRecord(record: GenericObject): Promise<void> {
    for (const converter of this.legacySettingsConverters) {
      converter(record);
    }
    await noopAsync();
  }

  /**
   * Called when settings are loaded or reloaded.
   *
   * @param _loadedState - The loaded settings state.
   * @param _isInitialLoad - Whether this is the initial load.
   */
  protected async onLoadSettings(
    _loadedState: ReadonlyPluginSettingsState<PluginSettings>,
    _isInitialLoad: boolean
  ): Promise<void> {
    await noopAsync();
  }

  /**
   * Called when settings are saved.
   *
   * @param params - The parameters.
   */
  protected async onSaveSettings(params: PluginSettingsComponentBaseOnSaveSettingsParams<PluginSettings>): Promise<void> {
    const {
      context: _context,
      newState: _newState,
      oldState: _oldState
    } = params;
    await noopAsync();
  }

  /**
   * Called when the plugin settings record is about to be saved to disk.
   *
   * @param _record - The record.
   */
  protected async onSavingRecord(_record: GenericObject): Promise<void> {
    await noopAsync();
  }

  /**
   * Registers the legacy settings converters.
   * Override to register legacy settings converters.
   */
  protected registerLegacySettingsConverters(): void {
    noop();
  }

  /**
   * Registers the validators.
   * Override to register validators for properties.
   */
  protected registerValidators(): void {
    noop();
  }

  private async cloneSettings(settings: PluginSettings): Promise<PluginSettings> {
    const record = await this.settingsToRawRecord(settings);
    const json = JSON.stringify(record);
    const cloneRecord = JSON.parse(json) as GenericObject;
    return await this.rawRecordToSettings(cloneRecord);
  }

  private async cloneState(
    state: PluginSettingsState<PluginSettings>
  ): Promise<PluginSettingsState<PluginSettings>> {
    return {
      effectiveValues: await this.cloneSettings(state.effectiveValues),
      inputValues: await this.cloneSettings(state.inputValues),
      validationMessages: { ...state.validationMessages }
    };
  }

  private createDefaultState(): PluginSettingsState<PluginSettings> {
    return {
      effectiveValues: new this.pluginSettingsClass(),
      inputValues: new this.pluginSettingsClass(),
      validationMessages: castTo<Record<PropertyNames<PluginSettings>, string>>({})
    };
  }

  private async edit(settingsEditor: (settings: PluginSettings) => Promisable<void>): Promise<void> {
    try {
      await settingsEditor(this.currentState.inputValues);
    } finally {
      const validationResult = await this.validate(this.currentState.inputValues);
      for (const propertyName of this.propertyNames) {
        const validationMessage = validationResult[propertyName] ?? '';
        this.currentState.validationMessages[propertyName] = validationMessage;
        const defaults = this.defaultSettings as PluginSettings;
        this.currentState.effectiveValues[propertyName] = validationMessage
          ? defaults[propertyName]
          : this.currentState.inputValues[propertyName];
      }
    }
  }

  private isValidPropertyName(property: unknown): property is PropertyNames<PluginSettings> {
    return typeof property === 'string' && (this.propertyNames as string[]).includes(property);
  }

  /**
   * Keeps a recovery copy before the initial load's normalizing save, when that save would drop or change a stored
   * value: an unknown key (a newer plugin version's setting), a legacy migration, a value the transformer rewrites.
   * Adding defaults for keys the file lacks loses nothing and keeps no copy.
   *
   * @param originalJson - The record as the file held it, serialized before anything could mutate it.
   * @param newRecord - The record about to be saved.
   * @returns Whether the save may go ahead: nothing would be lost, a copy was kept, or the handler keeps no copies.
   */
  private async keepCopyBeforeLossyRewrite(originalJson: string | undefined, newRecord: GenericObject): Promise<boolean> {
    const recoveryStore = this.dataHandler.recoveryStore;
    if (!recoveryStore || originalJson === undefined) {
      return true;
    }
    // `data.json` held an object or `null` here: anything else was rejected before the save was considered.
    const originalRecord = JSON.parse(originalJson) as GenericObject | null;
    if (originalRecord === null) {
      return true;
    }
    const isLossy = Object.keys(originalRecord).some((key) => !Object.hasOwn(newRecord, key) || !isDeepEqual(newRecord[key], originalRecord[key]));
    if (!isLossy) {
      return true;
    }

    try {
      await recoveryStore.keep({ path: 'data.json', rawText: originalJson, reason: SettingsRecoveryReason.LossyRewrite });
      return true;
    } catch (error) {
      console.error(new Error('Could not keep a recovery copy of data.json, so the normalized settings were not saved over it.', { cause: error }));
      return false;
    }
  }

  private markLoadedFromFile(): void {
    this.isLoadedFromFile = true;
    // Drained rather than iterated, so the list does not keep every past waiter alive across reloads.
    const resolvers = this.loadedFromFileResolvers.splice(0);
    for (const resolve of resolvers) {
      resolve();
    }
  }

  private async rawRecordToSettings(rawRecord: GenericObject): Promise<PluginSettings> {
    rawRecord = this.getTransformer().transformObjectRecursively(rawRecord);
    await this.onLoadRecord(rawRecord);

    const settings = new this.pluginSettingsClass();
    const defaults = this.defaultSettings as PluginSettings;

    for (const [propertyName, value] of Object.entries(rawRecord)) {
      if (!this.isValidPropertyName(propertyName)) {
        getObsidianLibDebugger('PluginSettingsComponentBase:rawRecordToSettings')(`Unknown property: ${propertyName}`);
        continue;
      }

      // JSON cannot hold `undefined`, so only a legacy converter produces it. Keep the default rather than
      // letting a converter that assigned a key it had nothing for wipe it out.
      if (value === undefined) {
        continue;
      }

      if (typeof value !== typeof defaults[propertyName]) {
        getObsidianLibDebugger('PluginSettingsComponentBase:rawRecordToSettings')(
          'Possible invalid value type. It might lead to an unexpected behavior of the plugin. There is also a chance it is a false-negative warning, as we are unable to determine the exact type of the value in runtime.',
          {
            defaultValue: defaults[propertyName],
            propertyName,
            value
          }
        );
      }

      settings[propertyName] = value as PropertyValues<PluginSettings>;
    }

    return settings;
  }

  private async saveToFileImpl(): Promise<void> {
    await this.dataHandler.saveData(await this.settingsToRawRecord(this.currentState.inputValues));
  }

  private setPropertyImpl(params: PluginSettingsComponentBaseSetPropertyImplParams<PluginSettings>): void {
    const {
      propertyName,
      validationMessage,
      value
    } = params;
    const defaults = this.defaultSettings as PluginSettings;
    this.currentState.inputValues[propertyName] = value;
    this.currentState.validationMessages[propertyName] = validationMessage ?? '';
    this.currentState.effectiveValues[propertyName] = validationMessage ? defaults[propertyName] : value;
  }

  private async settingsToRawRecord(settings: PluginSettings): Promise<GenericObject> {
    const rawRecord: GenericObject = {};

    for (const propertyName of this.propertyNames) {
      rawRecord[propertyName] = settings[propertyName];
    }

    await this.onSavingRecord(rawRecord);

    return this.getTransformer().transformObjectRecursively(rawRecord);
  }
}
