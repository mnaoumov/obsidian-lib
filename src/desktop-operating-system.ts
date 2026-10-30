/**
 * @file
 *
 * Reads the desktop operating system's name and version, for a bug report.
 *
 * Desktop only: it reads `node:os`. Reach it through {@link ./bug-report.ts | bug-report}, which imports
 * it dynamically on desktop.
 */

import {
  release,
  version
} from 'node:os';

/**
 * Gets the operating system's name and release, such as `Windows 11 Pro 10.0.26100`.
 *
 * @returns The operating system's name and release.
 */
export function getDesktopOperatingSystem(): string {
  return `${version()} ${release()}`;
}
