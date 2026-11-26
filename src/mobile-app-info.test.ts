// @vitest-environment jsdom

// The Android emulator's model name.
// cspell:words gphone

import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { getMobileAppInfo } from './mobile-app-info.ts';

function setCapacitor(capacitor: unknown): void {
  Object.assign(window, { Capacitor: capacitor });
}

function setNativePromise(answers: Readonly<Record<string, unknown>>): void {
  setCapacitor({
    nativePromise: (pluginName: string, methodName: string): Promise<unknown> => {
      expect(methodName).toBe('getInfo');
      const answer = answers[pluginName];
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    }
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'Capacitor');
  vi.restoreAllMocks();
});

describe('getMobileAppInfo', () => {
  it('should resolve to null without a Capacitor bridge', async () => {
    expect(await getMobileAppInfo()).toBeNull();
  });

  it('should resolve to null when the bridge has no nativePromise', async () => {
    setCapacitor({});
    expect(await getMobileAppInfo()).toBeNull();
  });

  it('should format the app build, the Android version and API level, the device model and the web view', async () => {
    setNativePromise({
      App: { build: '291', version: '1.15.0' },
      Device: {
        androidSDKVersion: 35,
        isVirtual: false,
        manufacturer: 'Google',
        model: 'Pixel 8',
        // The name the user gave the device is never read.
        name: 'Alice phone',
        osVersion: '15',
        platform: 'android',
        webViewVersion: '140.0.7339.51'
      }
    });

    expect(await getMobileAppInfo()).toEqual({
      device: 'Google Pixel 8',
      installerVersion: '1.15.0 (291)',
      operatingSystem: 'Android 15 (API 35)',
      webViewVersion: '140.0.7339.51'
    });
  });

  it('should name a virtual device an emulator on Android and a simulator on iOS', async () => {
    setNativePromise({
      App: { version: '1.15.0' },
      Device: { isVirtual: true, manufacturer: 'Google', model: 'sdk_gphone64_x86_64', osVersion: '14', platform: 'android' }
    });
    const androidInfo = await getMobileAppInfo();
    expect(androidInfo?.device).toBe('Google sdk_gphone64_x86_64, emulator');

    setNativePromise({
      App: { version: '1.15.0' },
      Device: { isVirtual: true, osVersion: '18.1', platform: 'ios' }
    });
    const iosInfo = await getMobileAppInfo();
    expect(iosInfo?.device).toBe('simulator');
  });

  it('should read an empty web view version as none, and keep the app version when the device call fails', async () => {
    setNativePromise({
      App: { version: '1.15.0' },
      Device: { osVersion: '15', platform: 'android', webViewVersion: '' }
    });
    const emptyWebViewInfo = await getMobileAppInfo();
    expect(emptyWebViewInfo?.webViewVersion).toBeNull();

    setNativePromise({
      App: { version: '1.15.0' },
      Device: new Error('not implemented')
    });
    expect(await getMobileAppInfo()).toEqual({
      device: null,
      installerVersion: '1.15.0',
      operatingSystem: null,
      webViewVersion: null
    });
  });

  it('should keep an unknown platform name as the device reports it', async () => {
    setNativePromise({
      App: { version: '1.15.0' },
      Device: { osVersion: '1', platform: 'web' }
    });
    const info = await getMobileAppInfo();
    expect(info?.operatingSystem).toBe('web 1');
  });

  it('should leave out a missing build and model', async () => {
    setNativePromise({
      App: { version: '1.15.0' },
      Device: { osVersion: '18.1', platform: 'ios' }
    });

    expect(await getMobileAppInfo()).toEqual({
      device: null,
      installerVersion: '1.15.0',
      operatingSystem: 'iOS 18.1',
      webViewVersion: null
    });
  });

  it('should keep the half of a model that is there', async () => {
    setNativePromise({
      App: { build: '', version: '1.15.0' },
      Device: { model: 'iPhone16,1', osVersion: '18.1', platform: 'ios' }
    });

    expect(await getMobileAppInfo()).toEqual({
      device: 'iPhone16,1',
      installerVersion: '1.15.0',
      operatingSystem: 'iOS 18.1',
      webViewVersion: null
    });
  });

  it('should answer null for a call that fails or answers in an unexpected shape', async () => {
    setNativePromise({
      App: new Error('not implemented'),
      Device: { platform: 'android' }
    });

    expect(await getMobileAppInfo()).toEqual({
      device: null,
      installerVersion: null,
      operatingSystem: null,
      webViewVersion: null
    });
  });
});
