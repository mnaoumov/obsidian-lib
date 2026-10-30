// @vitest-environment jsdom

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

  it('should format the app build and the device model', async () => {
    setNativePromise({
      App: { build: '291', version: '1.15.0' },
      Device: { manufacturer: 'Google', model: 'Pixel 8', osVersion: '15', platform: 'android' }
    });

    expect(await getMobileAppInfo()).toEqual({
      installerVersion: '1.15.0 (291)',
      operatingSystem: 'android 15 (Google Pixel 8)'
    });
  });

  it('should leave out a missing build and model', async () => {
    setNativePromise({
      App: { version: '1.15.0' },
      Device: { osVersion: '18.1', platform: 'ios' }
    });

    expect(await getMobileAppInfo()).toEqual({
      installerVersion: '1.15.0',
      operatingSystem: 'ios 18.1'
    });
  });

  it('should keep the half of a model that is there', async () => {
    setNativePromise({
      App: { build: '', version: '1.15.0' },
      Device: { model: 'iPhone16,1', osVersion: '18.1', platform: 'ios' }
    });

    expect(await getMobileAppInfo()).toEqual({
      installerVersion: '1.15.0',
      operatingSystem: 'ios 18.1 (iPhone16,1)'
    });
  });

  it('should answer null for a call that fails or answers in an unexpected shape', async () => {
    setNativePromise({
      App: new Error('not implemented'),
      Device: { platform: 'android' }
    });

    expect(await getMobileAppInfo()).toEqual({
      installerVersion: null,
      operatingSystem: null
    });
  });
});
