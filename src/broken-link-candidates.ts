/**
 * @file
 *
 * Where did a missing link target go? Pure, no `App`: every question about which file a broken link most likely
 * meant is answerable from a list of paths, the notes' aliases and titles, and the vault's git renames.
 *
 * A rename is not recoverable from the link alone: a link to `alpha/bravo/charlie/!.md` says nothing about
 * `charlie` having become `delta`. So every candidate carries the evidence that produced it, from outside the
 * link, and the finder never picks one of several: a caller offers a one-click fix only when exactly one
 * candidate exists. The one exception is a near miss, a name a few typing edits from the missing one, which only the
 * link's own spelling suggests; it ranks below every other kind.
 *
 * A link with no candidate at all, near misses included, is most likely a planned note rather than a broken one.
 */

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';

/**
 * The kind of evidence that makes a file a candidate for a missing link target.
 *
 * Candidates list evidence strongest first, in EVIDENCE_KIND_ORDER below.
 */
export enum BrokenLinkEvidenceKind {
  /**
   * The candidate's `aliases` hold the missing target's old name.
   */
  Alias = 'Alias',

  /**
   * The candidate's path differs from the missing one only in letter case.
   */
  CaseChange = 'CaseChange',

  /**
   * The vault's git history records the missing path being renamed to the candidate.
   */
  GitRename = 'GitRename',

  /**
   * The candidate's name is a few typing edits away from the missing name: a typo, or a small rename that left no
   * other evidence. The weakest kind, so it never outranks a file the vault itself points to.
   */
  NearMiss = 'NearMiss',

  /**
   * The missing target's folder is gone, and a sibling folder holds every missing target that was under it.
   */
  RenamedFolder = 'RenamedFolder',

  /**
   * A file with the same name, and the longest run of the same parent folders, sits elsewhere.
   */
  SameName = 'SameName',

  /**
   * The candidate's `title` is the missing target's old name.
   */
  Title = 'Title'
}

/**
 * A folder note's own name identifies nothing, so a same-name candidate must share its folder's name too.
 */
const FOLDER_NOTE_MIN_SUFFIX_LENGTH = 2;

const EVIDENCE_KIND_ORDER: readonly BrokenLinkEvidenceKind[] = [
  BrokenLinkEvidenceKind.GitRename,
  BrokenLinkEvidenceKind.CaseChange,
  BrokenLinkEvidenceKind.Alias,
  BrokenLinkEvidenceKind.Title,
  BrokenLinkEvidenceKind.RenamedFolder,
  BrokenLinkEvidenceKind.SameName,
  BrokenLinkEvidenceKind.NearMiss
];

/**
 * A name shorter than this has no near miss: one edit to `a.md` or `log.md` reaches too many unrelated names.
 */
const NEAR_MISS_MIN_NAME_LENGTH = 4;

/**
 * Each name this many characters long may be one edit more away, so a long name tolerates two typos.
 */
const NEAR_MISS_CHARACTERS_PER_EDIT = 8;

/**
 * No near miss is further away than this, however long the name: beyond it the name is another name.
 */
const NEAR_MISS_MAX_DISTANCE = 2;

/**
 * One file that a missing link target may have become, and why.
 */
export interface BrokenLinkCandidate {
  /**
   * Every reason this file is a candidate, strongest first.
   */
  readonly evidence: readonly BrokenLinkEvidence[];

  /**
   * The candidate's vault path.
   */
  readonly path: string;
}

/**
 * The parameters for {@link BrokenLinkCandidateFinder}.
 */
export interface BrokenLinkCandidateFinderConstructorParams {
  /**
   * Each note's `aliases`, by note path.
   */
  readonly aliasesByPath: ReadonlyMap<string, readonly string[]>;

  /**
   * Every file in the vault.
   */
  readonly filePaths: readonly string[];

  /**
   * The file names a folder note is stored under, such as `index.md`. Such a name says nothing about which
   * note it is, so a same-name candidate must share its folder's name too, and the old name an alias is
   * matched against is the folder's.
   */
  readonly folderNoteFileNames: readonly string[];

  /**
   * The vault's git renames: each old vault path to the path it was renamed to, chains already followed.
   */
  readonly gitRenames: ReadonlyMap<string, GitRename>;

  /**
   * Each note's `title`, by note path.
   */
  readonly titlesByPath: ReadonlyMap<string, string>;
}

/**
 * One reason a file is a candidate for a missing link target.
 */
export interface BrokenLinkEvidence {
  /**
   * A sentence naming the evidence, for the user to judge it by.
   */
  readonly description: string;

  /**
   * The kind of evidence.
   */
  readonly kind: BrokenLinkEvidenceKind;
}

/**
 * A rename recorded in the vault's git history.
 */
export interface GitRename {
  /**
   * The abbreviated hash of the commit that made the last rename of the chain.
   */
  readonly commit: string;

  /**
   * The vault path the file was last renamed to.
   */
  readonly newPath: string;
}

/**
 * The part of a missing path that a candidate replaced: what a "fix all like this" applies to every other link.
 */
export interface PathMapping {
  /**
   * The part of the candidate path that replaced {@link oldPrefix}; `''` for the vault root.
   */
  readonly newPrefix: string;

  /**
   * The leading part of the missing path that no longer exists; `''` for the vault root.
   */
  readonly oldPrefix: string;
}

type EvidenceAdder = (path: string, kind: BrokenLinkEvidenceKind, description: string) => void;

interface MissingSubtree {
  /**
   * Each missing path under the subtree's root, relative to it.
   */
  readonly remainders: Set<string>;

  readonly root: string;
}

interface NameEntry {
  /**
   * The name compared: the file name without its extension, or a folder note's folder name, in lower case.
   */
  readonly comparedName: string;

  readonly path: string;
}

interface NearMissKey {
  readonly comparedName: string;

  /**
   * The compared name in its own letter case, for the evidence description.
   */
  readonly displayName: string;

  /**
   * What a near miss must share with the missing path: its extension, or, for a folder note, its file name.
   */
  readonly group: string;
}

/**
 * Finds the candidates for missing link targets, from one snapshot of the vault.
 */
export class BrokenLinkCandidateFinder {
  private readonly aliasesByPath: ReadonlyMap<string, readonly string[]>;
  private readonly childFoldersByFolder = new Map<string, string[]>();
  private readonly filePathSet: ReadonlySet<string>;
  private readonly filesByLowerCasePath = new Map<string, string[]>();
  private readonly filesByName = new Map<string, string[]>();
  private readonly folderNoteFileNames: ReadonlySet<string>;
  private readonly folderPaths = new Set<string>(['']);
  private readonly gitRenames: ReadonlyMap<string, GitRename>;
  /**
   * The files a near miss may be, keyed by what a near miss must share: the lower-case extension, or a folder note's
   * file name.
   */
  private readonly nameEntriesByNearMissGroup = new Map<string, NameEntry[]>();
  private readonly titlesByPath: ReadonlyMap<string, string>;

  /**
   * Indexes the vault snapshot.
   *
   * @param params - The snapshot.
   */
  public constructor(params: BrokenLinkCandidateFinderConstructorParams) {
    this.aliasesByPath = params.aliasesByPath;
    this.filePathSet = new Set(params.filePaths);
    this.folderNoteFileNames = new Set(params.folderNoteFileNames);
    this.gitRenames = params.gitRenames;
    this.titlesByPath = params.titlesByPath;

    for (const filePath of params.filePaths) {
      addToMultiMap(this.filesByName, getName(filePath), filePath);
      addToMultiMap(this.filesByLowerCasePath, filePath.toLowerCase(), filePath);

      const nearMissKey = this.getNearMissKey(filePath);
      if (nearMissKey) {
        addToMultiMap(this.nameEntriesByNearMissGroup, nearMissKey.group, { comparedName: nearMissKey.comparedName, path: filePath });
      }

      let folder = getParentPath(filePath);
      while (!this.folderPaths.has(folder)) {
        this.folderPaths.add(folder);
        addToMultiMap(this.childFoldersByFolder, getParentPath(folder), folder);
        folder = getParentPath(folder);
      }
    }
  }

  /**
   * Finds the candidates for every missing path at once.
   *
   * All at once because one kind of evidence is collective: a renamed folder is recognized by every missing
   * target that was under it turning up together under one sibling folder.
   *
   * @param missingPaths - The vault paths that links lead to and no file holds.
   * @returns The candidates for each missing path, strongest first; an empty list when nothing is known.
   */
  public findAll(missingPaths: Iterable<string>): Map<string, BrokenLinkCandidate[]> {
    const uniqueMissingPaths = new Set(missingPaths);
    const missingSubtrees = this.getMissingSubtrees(uniqueMissingPaths);
    const result = new Map<string, BrokenLinkCandidate[]>();

    for (const missingPath of uniqueMissingPaths) {
      const evidenceByPath = new Map<string, BrokenLinkEvidence[]>();
      function add(path: string, kind: BrokenLinkEvidenceKind, description: string): void {
        addToMultiMap(evidenceByPath, path, { description, kind });
      }

      this.addGitRenameCandidate(missingPath, add);
      this.addCaseChangeCandidates(missingPath, add);
      this.addAliasAndTitleCandidates(missingPath, add);
      this.addRenamedFolderCandidates(missingPath, missingSubtrees, add);
      this.addSameNameCandidates(missingPath, add);
      this.addNearMissCandidates(missingPath, add);

      result.set(missingPath, sortCandidates(evidenceByPath));
    }

    return result;
  }

  private addAliasAndTitleCandidates(missingPath: string, add: EvidenceAdder): void {
    const name = getName(missingPath);
    const isFolderNote = this.folderNoteFileNames.has(name);
    let oldName: string;

    if (isFolderNote) {
      oldName = getName(getParentPath(missingPath));
      if (!oldName) {
        return;
      }
    } else if (name.toLowerCase().endsWith('.md')) {
      oldName = name.slice(0, -'.md'.length);
    } else {
      return;
    }

    const lowerCaseOldName = oldName.toLowerCase();
    const isEligible = (path: string): boolean => this.filePathSet.has(path) && (!isFolderNote || getName(path) === name);

    for (const [path, aliases] of this.aliasesByPath) {
      if (isEligible(path) && aliases.some((alias) => alias.toLowerCase() === lowerCaseOldName)) {
        add(path, BrokenLinkEvidenceKind.Alias, `Its aliases hold the old name "${oldName}".`);
      }
    }

    for (const [path, title] of this.titlesByPath) {
      if (isEligible(path) && title.toLowerCase() === lowerCaseOldName) {
        add(path, BrokenLinkEvidenceKind.Title, `Its title is the old name "${oldName}".`);
      }
    }
  }

  private addCaseChangeCandidates(missingPath: string, add: EvidenceAdder): void {
    for (const path of this.filesByLowerCasePath.get(missingPath.toLowerCase()) ?? []) {
      add(path, BrokenLinkEvidenceKind.CaseChange, 'Only the letter case of its path differs.');
    }
  }

  private addGitRenameCandidate(missingPath: string, add: EvidenceAdder): void {
    const gitRename = this.gitRenames.get(missingPath);
    if (gitRename && this.filePathSet.has(gitRename.newPath)) {
      add(gitRename.newPath, BrokenLinkEvidenceKind.GitRename, `Git history records the rename, in commit ${gitRename.commit}.`);
    }
  }

  /**
   * Adds the files whose name is the fewest edits from the missing name, within the name's own tolerance. Only the
   * nearest are kept, as for a same-name candidate, so one typo never lists every name two edits away beside it.
   *
   * @param missingPath - The missing path.
   * @param add - Adds one piece of evidence.
   */
  private addNearMissCandidates(missingPath: string, add: EvidenceAdder): void {
    const nearMissKey = this.getNearMissKey(missingPath);
    if (!nearMissKey) {
      return;
    }

    const missingName = nearMissKey.comparedName;
    const maxDistance = getNearMissMaxDistance(missingName.length);
    if (maxDistance === 0) {
      return;
    }

    let bestDistance = maxDistance + 1;
    let bestEntries: NameEntry[] = [];

    for (const entry of this.nameEntriesByNearMissGroup.get(nearMissKey.group) ?? []) {
      if (entry.comparedName === missingName) {
        // The same name, in any letter case, is a same-name or case-change candidate, not a near miss.
        continue;
      }

      const distance = getEditDistance(missingName, entry.comparedName, Math.min(bestDistance, maxDistance));
      if (distance > maxDistance) {
        continue;
      }
      if (distance < bestDistance) {
        bestDistance = distance;
        bestEntries = [entry];
      } else if (distance === bestDistance) {
        bestEntries.push(entry);
      }
    }

    for (const entry of bestEntries) {
      add(
        entry.path,
        BrokenLinkEvidenceKind.NearMiss,
        `Its name is ${bestDistance === 1 ? 'one edit' : `${String(bestDistance)} edits`} away from the missing name "${nearMissKey.displayName}".`
      );
    }
  }

  private addRenamedFolderCandidates(missingPath: string, missingSubtrees: ReadonlyMap<string, MissingSubtree>, add: EvidenceAdder): void {
    const missingSubtree = missingSubtrees.get(missingPath);
    if (!missingSubtree) {
      return;
    }

    const parentPath = getParentPath(missingSubtree.root);
    const remainder = getRelativePath(missingSubtree.root, missingPath);

    for (const siblingFolder of this.childFoldersByFolder.get(parentPath) ?? []) {
      const isSubtreeIntact = [...missingSubtree.remainders].every((path) => this.filePathSet.has(joinPath(siblingFolder, path)));
      if (!isSubtreeIntact) {
        continue;
      }

      const fileCount = missingSubtree.remainders.size;
      add(
        joinPath(siblingFolder, remainder),
        BrokenLinkEvidenceKind.RenamedFolder,
        `The folder "${missingSubtree.root}" is gone, and its sibling "${siblingFolder}" holds ${fileCount === 1 ? 'the missing file that was' : `all ${String(fileCount)} missing files that were`} under it.`
      );
    }
  }

  private addSameNameCandidates(missingPath: string, add: EvidenceAdder): void {
    const name = getName(missingPath);
    const minSuffixLength = this.folderNoteFileNames.has(name) ? FOLDER_NOTE_MIN_SUFFIX_LENGTH : 1;
    const missingSegments = missingPath.split('/');
    let bestSuffixLength = minSuffixLength;
    let bestPaths: string[] = [];

    for (const path of this.filesByName.get(name) ?? []) {
      const suffixLength = getCommonSuffixLength(missingSegments, path.split('/'));
      if (suffixLength > bestSuffixLength) {
        bestSuffixLength = suffixLength;
        bestPaths = [path];
      } else if (suffixLength === bestSuffixLength) {
        bestPaths.push(path);
      }
    }

    const suffix = missingSegments.slice(-bestSuffixLength).join('/');
    for (const path of bestPaths) {
      add(path, BrokenLinkEvidenceKind.SameName, `It has the same name, "${suffix}", in another folder.`);
    }
  }

  /**
   * Groups the missing paths by the highest missing folder above each, the root of a subtree that may have been
   * renamed as a whole.
   *
   * @param missingPaths - The missing paths.
   * @returns Each missing path's subtree; a path whose own folder exists has none.
   */
  private getMissingSubtrees(missingPaths: ReadonlySet<string>): Map<string, MissingSubtree> {
    const subtreesByRoot = new Map<string, MissingSubtree>();
    const result = new Map<string, MissingSubtree>();

    for (const missingPath of missingPaths) {
      let root = getParentPath(missingPath);
      if (this.folderPaths.has(root)) {
        continue;
      }

      while (!this.folderPaths.has(getParentPath(root))) {
        root = getParentPath(root);
      }

      let missingSubtree = subtreesByRoot.get(root);
      if (!missingSubtree) {
        missingSubtree = { remainders: new Set(), root };
        subtreesByRoot.set(root, missingSubtree);
      }

      missingSubtree.remainders.add(getRelativePath(root, missingPath));
      result.set(missingPath, missingSubtree);
    }

    return result;
  }

  /**
   * What a near miss of a path is judged by.
   *
   * @param path - A vault path.
   * @returns The group a near miss must share and the name compared within it; `null` for a root folder note.
   */
  private getNearMissKey(path: string): NearMissKey | null {
    const name = getName(path);
    if (this.folderNoteFileNames.has(name)) {
      const folderName = getName(getParentPath(path));
      return folderName ? { comparedName: folderName.toLowerCase(), displayName: folderName, group: `folder-note:${name}` } : null;
    }

    const dotIndex = name.lastIndexOf('.');
    const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
    const extension = dotIndex > 0 ? name.slice(dotIndex + 1) : '';
    return { comparedName: stem.toLowerCase(), displayName: stem, group: `extension:${extension.toLowerCase()}` };
  }
}

/**
 * The optimal-string-alignment distance: insertions, deletions, substitutions and swaps of two adjacent characters,
 * each one edit, so the commonest typos (a missed, doubled, wrong or swapped key) all cost one.
 *
 * @param source - The first string.
 * @param target - The second string.
 * @param limit - The largest distance of interest.
 * @returns The distance, or `limit + 1` once it is certain to exceed `limit`.
 */
export function getEditDistance(source: string, target: string, limit = Infinity): number {
  const tooFar = limit + 1;
  if (Math.abs(source.length - target.length) > limit) {
    return tooFar;
  }

  // Row `r`, column `c` holds the distance between the first `r` characters of `source` and the first `c` of `target`.
  let previousPrevious: number[] = [];
  let previous = Array.from({ length: target.length + 1 }, (_, column) => column);

  for (let sourcePosition = 0; sourcePosition < source.length; sourcePosition++) {
    const current = [sourcePosition + 1];
    let rowMinimum = sourcePosition + 1;

    for (let targetPosition = 0; targetPosition < target.length; targetPosition++) {
      const cost = source[sourcePosition] === target[targetPosition] ? 0 : 1;
      let value = Math.min(
        ensureNonNullable(previous[targetPosition + 1]) + 1,
        ensureNonNullable(current[targetPosition]) + 1,
        ensureNonNullable(previous[targetPosition]) + cost
      );
      const isSwap = sourcePosition > 0 && targetPosition > 0 && source[sourcePosition] === target[targetPosition - 1]
        && source[sourcePosition - 1] === target[targetPosition];
      if (isSwap) {
        value = Math.min(value, ensureNonNullable(previousPrevious[targetPosition - 1]) + 1);
      }
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }

    if (rowMinimum > limit) {
      return tooFar;
    }

    previousPrevious = previous;
    previous = current;
  }

  const distance = ensureNonNullable(previous[target.length]);
  return distance > limit ? tooFar : distance;
}

/**
 * How many edits a name may be from another and still be its near miss.
 *
 * @param nameLength - The missing name's length.
 * @returns The tolerance; `0` for a name too short to have a near miss.
 */
export function getNearMissMaxDistance(nameLength: number): number {
  return nameLength < NEAR_MISS_MIN_NAME_LENGTH
    ? 0
    : Math.min(NEAR_MISS_MAX_DISTANCE, 1 + Math.floor(nameLength / NEAR_MISS_CHARACTERS_PER_EDIT));
}

/**
 * The parent folder of a vault path.
 *
 * @param path - The path.
 * @returns The parent folder; `''` for the vault root.
 */
export function getParentPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

/**
 * The part of a missing path that a candidate path replaced, found by dropping the path segments they end with
 * in common.
 *
 * @param oldPath - The missing path.
 * @param newPath - The candidate path.
 * @returns The prefixes that differ.
 */
export function getPathMapping(oldPath: string, newPath: string): PathMapping {
  const oldSegments = oldPath.split('/');
  const newSegments = newPath.split('/');
  const suffixLength = getCommonSuffixLength(oldSegments, newSegments);
  return {
    newPrefix: newSegments.slice(0, newSegments.length - suffixLength).join('/'),
    oldPrefix: oldSegments.slice(0, oldSegments.length - suffixLength).join('/')
  };
}

function addToMultiMap<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  let values = map.get(key);
  if (!values) {
    values = [];
    map.set(key, values);
  }
  values.push(value);
}

function getCommonSuffixLength(segments1: readonly string[], segments2: readonly string[]): number {
  let length = 0;
  while (length < segments1.length && length < segments2.length && segments1.at(-length - 1) === segments2.at(-length - 1)) {
    length++;
  }
  return length;
}

function getEvidenceRank(evidence: BrokenLinkEvidence): number {
  return EVIDENCE_KIND_ORDER.indexOf(evidence.kind);
}

function getName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

// The folder is never the vault root here: a missing subtree's root is a missing folder, and its siblings are
// folders too.
function getRelativePath(folder: string, path: string): string {
  return path.slice(folder.length + 1);
}

function joinPath(folder: string, path: string): string {
  return `${folder}/${path}`;
}

function sortCandidates(evidenceByPath: ReadonlyMap<string, BrokenLinkEvidence[]>): BrokenLinkCandidate[] {
  const candidates = [...evidenceByPath].map(([path, evidence]) => ({
    evidence: evidence.sort((evidence1, evidence2) => getEvidenceRank(evidence1) - getEvidenceRank(evidence2)),
    path
  }));

  return candidates.sort((candidate1, candidate2) => {
    const rankDifference = getEvidenceRank(ensureNonNullable(candidate1.evidence[0])) - getEvidenceRank(ensureNonNullable(candidate2.evidence[0]));
    return rankDifference || candidate1.path.localeCompare(candidate2.path);
  });
}
