import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { createDesktopGitRunner } from './desktop-git-runner.ts';

interface ExecFileResult {
  readonly stdout: string;
}

const hoisted = vi.hoisted(() => ({
  execFile: vi.fn()
}));

vi.mock('node:child_process', () => ({ execFile: hoisted.execFile }));

describe('createDesktopGitRunner', () => {
  it('should defer loading Node until the runner is called', async () => {
    vi.resetModules();
    const nodeModuleLoaded = vi.fn(() => ({ execFile: hoisted.execFile }));
    vi.doMock('node:child_process', nodeModuleLoaded);
    try {
      const gitRunnerModule = await import('./desktop-git-runner.ts');
      gitRunnerModule.createDesktopGitRunner('C:/vault');
      expect(nodeModuleLoaded).not.toHaveBeenCalled();
    } finally {
      vi.doMock('node:child_process', () => ({ execFile: hoisted.execFile }));
      vi.resetModules();
    }
  });

  it('should run git in the folder and answer its standard output', async () => {
    hoisted.execFile.mockImplementation((_file: string, _arguments: string[], _options: unknown, callback: (error: Error | null, result: ExecFileResult) => void) => {
      callback(null, { stdout: 'output' });
    });

    const output = await createDesktopGitRunner('C:/vault')(['status']);

    expect(output).toBe('output');
    expect(hoisted.execFile).toHaveBeenCalledWith('git', ['status'], expect.objectContaining({ cwd: 'C:/vault', windowsHide: true }), expect.any(Function));
  });
});
