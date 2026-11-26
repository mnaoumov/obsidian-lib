/**
 * @file
 *
 * Reads the Obsidian mobile app's build and the device's operating system, model and web view, for a bug
 * report.
 *
 * Mobile only: it calls the Capacitor bridge's `nativePromise`, which Obsidian's own code uses but which
 * no public typing declares, so the shapes are declared here, narrowed to the members read, and checked
 * at run time. On any other runtime {@link getMobileAppInfo} resolves to `null`. Reach it through
 * {@link ./bug-report.ts | bug-report}.
 *
 * The device answer is Capacitor's `Device.getInfo()`. It also carries the name the user gave the device,
 * which is never read: a bug report is pasted into a public issue, so only coarse values that diagnose a
 * bug leave this module.
 */

import {
  functionTypeGuard,
  isBoolean,
  isNumber,
  isString,
  objectTypeGuard,
  optionalTypeGuard
} from '@mnaoumov/typescript-lib/type-guards';

/**
 * What the mobile app and its device report about themselves.
 */
export interface MobileAppInfo {
  /**
   * The device: its manufacturer and model, plus `emulator` or `simulator` for a virtual device, such as
   * `Google Pixel 8`, or `Google Pixel 8, emulator` for an emulated one; `null` when the device did not say.
   *
   * Optional, so a value built by hand before it existed still type-checks; {@link getMobileAppInfo}
   * always sets it.
   */
  readonly device?: null | string;

  /**
   * The installed app's version and build, such as `1.15.0 (291)`, or `null` when the app did not say.
   */
  readonly installerVersion: null | string;

  /**
   * The device's operating system and version, with the API level on Android, such as
   * `Android 15 (API 35)` or `iOS 18.1`, or `null` when the device did not say.
   */
  readonly operatingSystem: null | string;

  /**
   * The web view's version as the device reports it, such as `140.0.7339.51` for the Android System
   * WebView, or `null` when the device did not say.
   *
   * Optional, so a value built by hand before it existed still type-checks; {@link getMobileAppInfo}
   * always sets it.
   */
  readonly webViewVersion?: null | string;
}

interface AppInfo {
  readonly build?: string | undefined;
  readonly version: string;
}

interface CapacitorBridge {
  readonly nativePromise: (pluginName: string, methodName: string) => Promise<unknown>;
}

interface DeviceInfo {
  readonly androidSDKVersion?: number | undefined;
  readonly isVirtual?: boolean | undefined;
  readonly manufacturer?: string | undefined;
  readonly model?: string | undefined;
  readonly osVersion: string;
  readonly platform: string;
  readonly webViewVersion?: string | undefined;
}

interface WindowWithCapacitor {
  readonly Capacitor?: unknown;
}

const isAppInfo = objectTypeGuard<AppInfo>({
  build: optionalTypeGuard(isString),
  version: isString
});

const isCapacitorBridge = objectTypeGuard<CapacitorBridge>({
  nativePromise: functionTypeGuard<CapacitorBridge['nativePromise']>()
});

const isDeviceInfo = objectTypeGuard<DeviceInfo>({
  androidSDKVersion: optionalTypeGuard(isNumber),
  isVirtual: optionalTypeGuard(isBoolean),
  manufacturer: optionalTypeGuard(isString),
  model: optionalTypeGuard(isString),
  osVersion: isString,
  platform: isString,
  webViewVersion: optionalTypeGuard(isString)
});

const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  android: 'Android',
  ios: 'iOS'
};

/**
 * Gets what the mobile app and its device report about themselves.
 *
 * @returns The app's version and the device's operating system, model and web view, or `null` where there
 *   is no Capacitor bridge. Each field is `null` when its call fails or answers in an unexpected shape.
 */
export async function getMobileAppInfo(): Promise<MobileAppInfo | null> {
  const capacitor = (window as WindowWithCapacitor).Capacitor;
  if (!isCapacitorBridge(capacitor)) {
    return null;
  }

  const [appInfo, deviceInfo] = await Promise.all([
    callGetInfo(capacitor, 'App'),
    callGetInfo(capacitor, 'Device')
  ]);

  const installerVersion = isAppInfo(appInfo) ? formatAppInfo(appInfo) : null;
  if (!isDeviceInfo(deviceInfo)) {
    return { device: null, installerVersion, operatingSystem: null, webViewVersion: null };
  }

  return {
    device: formatDevice(deviceInfo),
    installerVersion,
    operatingSystem: formatOperatingSystem(deviceInfo),
    webViewVersion: deviceInfo.webViewVersion === undefined || deviceInfo.webViewVersion === '' ? null : deviceInfo.webViewVersion
  };
}

async function callGetInfo(capacitor: CapacitorBridge, pluginName: string): Promise<unknown> {
  try {
    return await capacitor.nativePromise(pluginName, 'getInfo');
  } catch {
    return null;
  }
}

function formatAppInfo(appInfo: AppInfo): string {
  return appInfo.build ? `${appInfo.version} (${appInfo.build})` : appInfo.version;
}

function formatDevice(deviceInfo: DeviceInfo): null | string {
  const model = [deviceInfo.manufacturer, deviceInfo.model].filter(Boolean).join(' ');
  const parts = model ? [model] : [];
  if (deviceInfo.isVirtual) {
    parts.push(deviceInfo.platform === 'ios' ? 'simulator' : 'emulator');
  }
  return parts.length === 0 ? null : parts.join(', ');
}

function formatOperatingSystem(deviceInfo: DeviceInfo): string {
  const platformName = PLATFORM_NAMES[deviceInfo.platform] ?? deviceInfo.platform;
  const operatingSystem = `${platformName} ${deviceInfo.osVersion}`;
  return deviceInfo.androidSDKVersion === undefined ? operatingSystem : `${operatingSystem} (API ${String(deviceInfo.androidSDKVersion)})`;
}
