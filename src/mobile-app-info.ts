/**
 * @file
 *
 * Reads the Obsidian mobile app's build and the device's operating system, for a bug report.
 *
 * Mobile only: it calls the Capacitor bridge's `nativePromise`, which Obsidian's own code uses but which
 * no public typing declares, so the shapes are declared here, narrowed to the members read, and checked
 * at run time. On any other runtime {@link getMobileAppInfo} resolves to `null`. Reach it through
 * {@link ./bug-report.ts | bug-report}.
 */

import {
  functionTypeGuard,
  isString,
  objectTypeGuard,
  optionalTypeGuard
} from '@mnaoumov/typescript-lib/type-guards';

/**
 * What the mobile app and its device report about themselves.
 */
export interface MobileAppInfo {
  /**
   * The installed app's version and build, such as `1.15.0 (291)`, or `null` when the app did not say.
   */
  readonly installerVersion: null | string;

  /**
   * The device's operating system, version and model, such as `android 15 (Google Pixel 8)`, or `null`
   * when the device did not say.
   */
  readonly operatingSystem: null | string;
}

interface AppInfo {
  readonly build?: string | undefined;
  readonly version: string;
}

interface CapacitorBridge {
  readonly nativePromise: (pluginName: string, methodName: string) => Promise<unknown>;
}

interface DeviceInfo {
  readonly manufacturer?: string | undefined;
  readonly model?: string | undefined;
  readonly osVersion: string;
  readonly platform: string;
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
  manufacturer: optionalTypeGuard(isString),
  model: optionalTypeGuard(isString),
  osVersion: isString,
  platform: isString
});

/**
 * Gets what the mobile app and its device report about themselves.
 *
 * @returns The app's version and the device's operating system, or `null` where there is no Capacitor
 *   bridge. Each field is `null` when its call fails or answers in an unexpected shape.
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

  return {
    installerVersion: isAppInfo(appInfo) ? formatAppInfo(appInfo) : null,
    operatingSystem: isDeviceInfo(deviceInfo) ? formatDeviceInfo(deviceInfo) : null
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

function formatDeviceInfo(deviceInfo: DeviceInfo): string {
  const operatingSystem = `${deviceInfo.platform} ${deviceInfo.osVersion}`;
  const model = [deviceInfo.manufacturer, deviceInfo.model].filter(Boolean).join(' ');
  return model ? `${operatingSystem} (${model})` : operatingSystem;
}
