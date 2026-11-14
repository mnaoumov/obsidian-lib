/**
 * @file
 *
 * Whether an attachment sits outside the attachment folder of the notes that use it, and which notes are its
 * proper home.
 *
 * Two things here are easy to get wrong:
 *
 * - **The judgement is about the FOLDER, not the path.** `getAttachmentFilePath` answers about the proper
 *   path, folder and templated base name both, so judging on it raw flags every attachment whose NAME does not
 *   match a rename template. That is a different defect. So the comparison is folder against folder, through
 *   `getAttachmentFolderPathForAttachment`, which also skips the name generation that dominates the cost of
 *   the question when `Custom Attachment Location` answers it.
 * - **The proper folder is asked for the REAL attachment, never a dummy.** A folder template may read the
 *   attachment's own name, extension or stats, so `getAttachmentFolderPath`'s dummy-file route can answer
 *   about a file that does not exist.
 *
 * A reference is judged from the note that makes it: `A.md` linking `B/image.png`, which sits in `B.md`'s folder,
 * is A linking an EXTERNAL attachment, even when B uses it too. Whether such a reference is worth reporting depends
 * on whether the attachment has a proper note anywhere, which is known only after every note has been judged, so
 * {@link MisplacedAttachmentIndex} collects the verdicts and {@link MisplacedAttachmentIndex.getReported} applies
 * the {@link ExternalAttachmentLinkMode} at the end.
 *
 * Rendering is the caller's: this module only judges and collects.
 */

import type {
  App,
  Reference,
  TFile
} from 'obsidian';

import {
  getDataAdapterEx,
  parentFolderPath
} from '@obsidian-typings/obsidian-public-latest/implementations';

import {
  AttachmentPathContext,
  getAttachmentFolderPathForAttachment
} from './attachment-path.ts';
import { isNote } from './file-system.ts';

/**
 * Which references to an attachment outside the referencing note's attachment folder are reported.
 */
export enum ExternalAttachmentLinkMode {
  /**
   * Never report one: nothing is judged at all.
   */
  Ignore = 'Ignore',

  /**
   * Report every such reference, including one to an attachment filed in the folder of another note that
   * references it too.
   */
  Report = 'Report',

  /**
   * Report such a reference only when no note that references the attachment has it in its own folder.
   */
  ReportUnowned = 'ReportUnowned'
}

/**
 * The folder an attachment sits in, judged against the folder one note's configuration puts its attachments in.
 */
export interface AttachmentPlacement {
  /**
   * Whether the attachment sits in {@link AttachmentPlacement.properAttachmentFolderPath}, compared the way the
   * vault's adapter compares names (case-folded on a case-insensitive adapter).
   */
  readonly isInProperFolder: boolean;

  /**
   * The vault-relative folder the note's configuration puts this attachment in, `/` for the vault root.
   */
  readonly properAttachmentFolderPath: string;
}

/**
 * Parameters for {@link getAttachmentPlacement}.
 */
export interface GetAttachmentPlacementParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * The attachment to judge.
   */
  readonly attachmentFile: TFile;

  /**
   * The vault-relative path of the note whose configuration the attachment is judged against.
   */
  readonly notePath: string;
}

/**
 * One reference to an attachment outside the attachment folder of the note that makes it.
 *
 * The same attachment referenced from two notes is two entries, because the two notes can configure different
 * attachment folders.
 */
export interface MisplacedAttachmentEntry {
  /**
   * The attachment's current vault-relative path.
   */
  readonly attachmentPath: string;

  /**
   * The vault-relative folder the referencing note's configuration puts the attachment in.
   */
  readonly properAttachmentFolderPath: string;

  /**
   * The reference that reaches the attachment.
   */
  readonly reference: Reference;
}

/**
 * Parameters for {@link recordAttachmentPlacement}.
 */
export interface RecordAttachmentPlacementParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * The file the reference resolved to. Pass only references that resolved: an unresolved one is a broken link,
   * not a misplaced attachment.
   */
  readonly attachmentFile: TFile;

  /**
   * The index the verdict is recorded in.
   */
  readonly index: MisplacedAttachmentIndex;

  /**
   * Whether a path is never judged, for example because the user excluded it. Defaults to judging every path.
   */
  readonly isPathIgnored?: (path: string) => boolean;

  /**
   * Whether a path lies in a shared attachment location, which is anybody's folder, so no reference into it is
   * external. Defaults to no shared location.
   */
  readonly isSharedAttachmentPath?: (path: string) => boolean;

  /**
   * Whether a note is treated as an attachment (an `.excalidraw.md` file, say), and so judged here. Defaults to
   * no note being one.
   */
  readonly isTreatedAsAttachment?: (path: string) => boolean;

  /**
   * The vault-relative path of the note that makes the reference.
   */
  readonly notePath: string;

  /**
   * The reference, kept in the entry so a report can name its line or frontmatter key.
   */
  readonly reference: Reference;
}

/**
 * The verdicts of a walk over every reference to an attachment, grouped by the note that makes the reference.
 *
 * It keeps every external reference, every note that uses each attachment, and each attachment's proper notes:
 * the notes that reference it and whose own folder holds it. Which entries count as reported depends on the
 * {@link ExternalAttachmentLinkMode} and on the proper notes, which are known only once the whole vault has been
 * walked, so ask {@link MisplacedAttachmentIndex.getReported} after the walk.
 */
export class MisplacedAttachmentIndex extends Map<string, MisplacedAttachmentEntry[]> {
  private readonly properNotePathsByAttachment = new Map<string, Set<string>>();
  private readonly userNotePathsByAttachment = new Map<string, Set<string>>();

  /**
   * Creates an empty index.
   *
   * @param mode - Which external references {@link MisplacedAttachmentIndex.getReported} returns.
   */
  public constructor(public readonly mode = ExternalAttachmentLinkMode.Report) {
    super();
  }

  /**
   * Records a reference to an attachment outside the referencing note's folder.
   *
   * @param notePath - The referencing note's vault-relative path.
   * @param entry - The reference and the folder the note wants the attachment in.
   */
  public add(notePath: string, entry: MisplacedAttachmentEntry): void {
    let entries = this.get(notePath);
    if (!entries) {
      entries = [];
      this.set(notePath, entries);
    }
    entries.push(entry);
    this.addUser(entry.attachmentPath, notePath);
  }

  /**
   * Records that a note references an attachment, wherever the attachment sits.
   *
   * @param attachmentPath - The attachment's vault-relative path.
   * @param notePath - The referencing note's vault-relative path.
   */
  public addUser(attachmentPath: string, notePath: string): void {
    addToSetMap(this.userNotePathsByAttachment, attachmentPath, notePath);
  }

  /**
   * The notes that use an attachment besides the given one, its proper notes first, each group in walk order.
   *
   * @param attachmentPath - The attachment's vault-relative path.
   * @param notePath - The note to leave out: the one whose reference is being reported.
   * @returns The other notes' paths.
   */
  public getOtherUserNotePaths(attachmentPath: string, notePath: string): string[] {
    const properNotePaths = this.getProperNotePaths(attachmentPath);
    const userNotePaths = [...this.userNotePathsByAttachment.get(attachmentPath) ?? []];
    return [...properNotePaths, ...userNotePaths.filter((path) => !properNotePaths.includes(path))].filter((path) => path !== notePath);
  }

  /**
   * The proper notes of an attachment: the notes that reference it and whose own folder holds it, in walk order.
   *
   * @param attachmentPath - The attachment's vault-relative path.
   * @returns The proper notes' paths, empty when the attachment has none.
   */
  public getProperNotePaths(attachmentPath: string): string[] {
    return [...this.properNotePathsByAttachment.get(attachmentPath) ?? []];
  }

  /**
   * The entries to report, after the mode is applied, grouped by note, with a note left out once none of its
   * entries survive.
   *
   * @returns The entries to report.
   */
  public getReported(): Map<string, MisplacedAttachmentEntry[]> {
    const reported = new Map<string, MisplacedAttachmentEntry[]>();
    if (this.mode === ExternalAttachmentLinkMode.Ignore) {
      return reported;
    }

    for (const [notePath, entries] of this) {
      const surviving = this.mode === ExternalAttachmentLinkMode.ReportUnowned
        ? entries.filter((entry) => !this.properNotePathsByAttachment.has(entry.attachmentPath))
        : entries;
      if (surviving.length > 0) {
        reported.set(notePath, surviving);
      }
    }
    return reported;
  }

  /**
   * Whether a note is a proper note of an attachment: it references it, and its own folder holds it.
   *
   * @param attachmentPath - The attachment's vault-relative path.
   * @param notePath - The note's vault-relative path.
   * @returns `true` when the note's own attachment folder holds the attachment.
   */
  public isProperNote(attachmentPath: string, notePath: string): boolean {
    return this.properNotePathsByAttachment.get(attachmentPath)?.has(notePath) ?? false;
  }

  /**
   * Records that an attachment sits in the folder configured for a note that references it, which makes that
   * note its proper note.
   *
   * @param attachmentPath - The attachment's vault-relative path.
   * @param notePath - The referencing note whose folder holds it.
   */
  public markHomed(attachmentPath: string, notePath: string): void {
    addToSetMap(this.properNotePathsByAttachment, attachmentPath, notePath);
    this.addUser(attachmentPath, notePath);
  }
}

/**
 * Judges where an attachment sits against the attachment folder of one note.
 *
 * Asks the attachment-path seam once, folder-only, for the REAL attachment, so a `Custom Attachment Location`
 * folder template that reads the attachment's own name is honoured and no name is generated.
 *
 * @param params - The attachment and the note.
 * @returns The note's proper folder for the attachment, and whether the attachment is in it.
 */
export async function getAttachmentPlacement(params: GetAttachmentPlacementParams): Promise<AttachmentPlacement> {
  const { app, attachmentFile, notePath } = params;
  const properAttachmentFolderPath = await getAttachmentFolderPathForAttachment({
    app,
    attachmentPathOrFile: attachmentFile,
    context: AttachmentPathContext.Unknown,
    notePathOrFile: notePath
  });

  // Fold as `isAtProperAttachmentPath` does, so a case-insensitive adapter does not report a folder that differs
  // only in case.
  const isInsensitive = getDataAdapterEx(app).insensitive;
  return {
    isInProperFolder: fold(parentFolderPath(attachmentFile.path)) === fold(properAttachmentFolderPath),
    properAttachmentFolderPath
  };

  function fold(value: string): string {
    return isInsensitive ? value.toLowerCase() : value;
  }
}

/**
 * Judges one resolved reference and records the verdict in the index.
 *
 * Records nothing under {@link ExternalAttachmentLinkMode.Ignore}, for a note that is not treated as an
 * attachment, and for an ignored or shared path. Otherwise the referencing note becomes a proper note of the
 * attachment when its folder holds it, and the reference becomes an entry when it does not.
 *
 * @param params - The reference, its note, its target and the index.
 * @returns A {@link Promise} that resolves once the verdict is recorded.
 */
export async function recordAttachmentPlacement(params: RecordAttachmentPlacementParams): Promise<void> {
  const {
    app,
    attachmentFile,
    index,
    isPathIgnored = isNone,
    isSharedAttachmentPath = isNone,
    isTreatedAsAttachment = isNone,
    notePath,
    reference
  } = params;

  if (index.mode === ExternalAttachmentLinkMode.Ignore) {
    return;
  }

  if (isNote(attachmentFile) && !isTreatedAsAttachment(attachmentFile.path)) {
    return;
  }

  if (isPathIgnored(attachmentFile.path) || isSharedAttachmentPath(attachmentFile.path)) {
    return;
  }

  const placement = await getAttachmentPlacement({ app, attachmentFile, notePath });

  if (placement.isInProperFolder) {
    index.markHomed(attachmentFile.path, notePath);
    return;
  }

  index.add(notePath, {
    attachmentPath: attachmentFile.path,
    properAttachmentFolderPath: placement.properAttachmentFolderPath,
    reference
  });
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  let set = map.get(key);
  if (!set) {
    set = new Set<string>();
    map.set(key, set);
  }
  set.add(value);
}

function isNone(): boolean {
  return false;
}
