import type {
  App,
  Reference,
  TFile
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

interface DataAdapterExLike {
  readonly insensitive: boolean;
}

const hoisted = vi.hoisted(() => ({
  insensitive: false
}));

vi.mock('@obsidian-typings/obsidian-public-latest/implementations', async (importOriginal) => ({
  ...await importOriginal<typeof import('@obsidian-typings/obsidian-public-latest/implementations')>(),
  getDataAdapterEx: (): DataAdapterExLike => ({ insensitive: hoisted.insensitive })
}));

vi.mock('./attachment-path.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./attachment-path.ts')>(),
  getAttachmentFolderPathForAttachment: vi.fn()
}));

vi.mock('./file-system.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./file-system.ts')>(),
  isNote: vi.fn()
}));

// eslint-disable-next-line import-x/first, import-x/imports-first -- vi.mock must precede imports.
import { getAttachmentFolderPathForAttachment } from './attachment-path.ts';
// eslint-disable-next-line import-x/first, import-x/imports-first -- vi.mock must precede imports.
import { isNote } from './file-system.ts';
// eslint-disable-next-line import-x/first, import-x/imports-first -- vi.mock must precede imports.
import {
  ExternalAttachmentLinkMode,
  getAttachmentPlacement,
  MisplacedAttachmentIndex,
  recordAttachmentPlacement
} from './misplaced-attachment.ts';

const mockGetAttachmentFolderPathForAttachment = vi.mocked(getAttachmentFolderPathForAttachment);
const isNoteMock = vi.mocked(isNote);

const app = castTo<App>({});

function createFile(path: string): TFile {
  return castTo<TFile>({ path });
}

function createReference(link: string): Reference {
  return castTo<Reference>({ link, original: `[[${link}]]` });
}

function proper(folderPath: string): void {
  mockGetAttachmentFolderPathForAttachment.mockResolvedValue(folderPath);
}

async function record(
  index: MisplacedAttachmentIndex,
  notePath: string,
  attachmentPath: string,
  extra: Partial<Parameters<typeof recordAttachmentPlacement>[0]> = {}
): Promise<void> {
  await recordAttachmentPlacement({
    app,
    attachmentFile: createFile(attachmentPath),
    index,
    notePath,
    reference: createReference(attachmentPath),
    ...extra
  });
}

beforeEach(() => {
  hoisted.insensitive = false;
  mockGetAttachmentFolderPathForAttachment.mockReset();
  isNoteMock.mockReset();
  isNoteMock.mockReturnValue(false);
});

describe('getAttachmentPlacement', () => {
  it('should ask for the folder of the REAL attachment, against the note', async () => {
    proper('A');
    const attachmentFile = createFile('A/image.png');
    const placement = await getAttachmentPlacement({ app, attachmentFile, notePath: 'A.md' });
    expect(placement).toEqual({ isInProperFolder: true, properAttachmentFolderPath: 'A' });
    expect(mockGetAttachmentFolderPathForAttachment).toHaveBeenCalledWith(expect.objectContaining({
      app,
      attachmentPathOrFile: attachmentFile,
      notePathOrFile: 'A.md'
    }));
  });

  it('should say an attachment in another folder is not in its proper folder', async () => {
    proper('A');
    const placement = await getAttachmentPlacement({ app, attachmentFile: createFile('B/image.png'), notePath: 'A.md' });
    expect(placement.isInProperFolder).toBe(false);
  });

  it('should treat the vault root as `/`', async () => {
    proper('/');
    const placement = await getAttachmentPlacement({ app, attachmentFile: createFile('image.png'), notePath: 'A.md' });
    expect(placement.isInProperFolder).toBe(true);
  });

  it('should not fold case on a case-sensitive adapter', async () => {
    proper('a');
    const placement = await getAttachmentPlacement({ app, attachmentFile: createFile('A/image.png'), notePath: 'A.md' });
    expect(placement.isInProperFolder).toBe(false);
  });

  it('should fold case on a case-insensitive adapter', async () => {
    hoisted.insensitive = true;
    proper('a');
    const placement = await getAttachmentPlacement({ app, attachmentFile: createFile('A/image.png'), notePath: 'A.md' });
    expect(placement.isInProperFolder).toBe(true);
  });
});

describe('recordAttachmentPlacement', () => {
  it('should record an attachment outside the note\'s folder', async () => {
    proper('A');
    const index = new MisplacedAttachmentIndex();
    await record(index, 'A.md', 'B/image.png');
    expect(index.get('A.md')).toEqual([{
      attachmentPath: 'B/image.png',
      properAttachmentFolderPath: 'A',
      reference: createReference('B/image.png')
    }]);
    expect(index.getProperNotePaths('B/image.png')).toEqual([]);
  });

  it('should make the note a proper note when its folder holds the attachment', async () => {
    proper('A');
    const index = new MisplacedAttachmentIndex();
    await record(index, 'A.md', 'A/image.png');
    expect(index.size).toBe(0);
    expect(index.isProperNote('A/image.png', 'A.md')).toBe(true);
    expect(index.getProperNotePaths('A/image.png')).toEqual(['A.md']);
  });

  it('should ask nothing under Ignore', async () => {
    const index = new MisplacedAttachmentIndex(ExternalAttachmentLinkMode.Ignore);
    await record(index, 'A.md', 'B/image.png');
    expect(mockGetAttachmentFolderPathForAttachment).not.toHaveBeenCalled();
    expect(index.size).toBe(0);
  });

  it('should skip a note unless it is treated as an attachment', async () => {
    proper('A');
    isNoteMock.mockReturnValue(true);
    const index = new MisplacedAttachmentIndex();
    await record(index, 'A.md', 'B/drawing.md');
    expect(index.size).toBe(0);
    await record(index, 'A.md', 'B/drawing.md', { isTreatedAsAttachment: (path) => path === 'B/drawing.md' });
    expect(index.get('A.md')).toHaveLength(1);
  });

  it('should skip an ignored path and a shared path', async () => {
    proper('A');
    const index = new MisplacedAttachmentIndex();
    await record(index, 'A.md', 'B/image.png', { isPathIgnored: () => true });
    await record(index, 'A.md', 'B/image.png', { isSharedAttachmentPath: () => true });
    expect(index.size).toBe(0);
    expect(mockGetAttachmentFolderPathForAttachment).not.toHaveBeenCalled();
  });
});

describe('MisplacedAttachmentIndex', () => {
  it('should default to Report', () => {
    expect(new MisplacedAttachmentIndex().mode).toBe(ExternalAttachmentLinkMode.Report);
  });

  it('should report A and name B as the proper note, whichever note comes first', async () => {
    for (const order of [['A.md', 'B.md'], ['B.md', 'A.md']]) {
      const index = new MisplacedAttachmentIndex();
      for (const notePath of order) {
        proper(notePath === 'A.md' ? 'A' : 'B');
        await record(index, notePath, 'B/image.png');
      }
      expect([...index.getReported().keys()]).toEqual(['A.md']);
      expect(index.getOtherUserNotePaths('B/image.png', 'A.md')).toEqual(['B.md']);
    }
  });

  it('should list the proper notes first, then the other users, leaving out the given note', () => {
    const index = new MisplacedAttachmentIndex();
    const entry = { attachmentPath: 'X/image.png', properAttachmentFolderPath: 'A', reference: createReference('X/image.png') };
    index.add('A.md', entry);
    index.add('C.md', entry);
    index.add('C.md', entry);
    index.markHomed('X/image.png', 'X.md');
    expect(index.get('C.md')).toHaveLength(2);
    expect(index.getOtherUserNotePaths('X/image.png', 'A.md')).toEqual(['X.md', 'C.md']);
    expect(index.getOtherUserNotePaths('Y/image.png', 'A.md')).toEqual([]);
    expect(index.isProperNote('Y/image.png', 'A.md')).toBe(false);
  });

  it('should leave out an owned attachment under ReportUnowned, and a note with nothing left', () => {
    const index = new MisplacedAttachmentIndex(ExternalAttachmentLinkMode.ReportUnowned);
    index.add('A.md', { attachmentPath: 'B/owned.png', properAttachmentFolderPath: 'A', reference: createReference('B/owned.png') });
    index.add('C.md', { attachmentPath: 'B/owned.png', properAttachmentFolderPath: 'C', reference: createReference('B/owned.png') });
    index.add('C.md', { attachmentPath: 'Z/stray.png', properAttachmentFolderPath: 'C', reference: createReference('Z/stray.png') });
    index.markHomed('B/owned.png', 'B.md');
    const reported = index.getReported();
    expect([...reported.keys()]).toEqual(['C.md']);
    expect(reported.get('C.md')?.map((entry) => entry.attachmentPath)).toEqual(['Z/stray.png']);
  });

  it('should report nothing under Ignore, whatever it holds', () => {
    const index = new MisplacedAttachmentIndex(ExternalAttachmentLinkMode.Ignore);
    index.add('A.md', { attachmentPath: 'B/image.png', properAttachmentFolderPath: 'A', reference: createReference('B/image.png') });
    expect(index.getReported().size).toBe(0);
  });
});
