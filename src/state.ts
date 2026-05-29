import * as vscode from 'vscode';

const STATE_KEY = 'smartOpenedFiles.state.v1';

export const HISTORY_GROUP_ID = '__history__';
const HISTORY_GROUP_NAME = 'History';

export interface GroupRecord {
  id: string;
  name: string;
  files: string[];
  isSystem?: boolean;
}

export interface PersistedState {
  groups: GroupRecord[];
  ungrouped: string[];
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

export class GroupStateStore {
  private state: PersistedState;

  constructor(private readonly workspaceState: vscode.Memento) {
    const raw = workspaceState.get<PersistedState>(STATE_KEY);
    this.state = this.normalize(raw);
  }

  private normalize(raw: PersistedState | undefined): PersistedState {
    if (!raw) {
      return { groups: [], ungrouped: [] };
    }

    const groups = (raw.groups ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      files: dedupe(group.files ?? []),
      isSystem: group.isSystem
    }));

    const groupedFiles = new Set(groups.flatMap((group) => group.files));
    const ungrouped = dedupe((raw.ungrouped ?? []).filter((file) => !groupedFiles.has(file)));

    return { groups, ungrouped };
  }

  public snapshot(): PersistedState {
    return {
      groups: this.state.groups.map((group) => ({
        id: group.id,
        name: group.name,
        files: [...group.files],
        isSystem: group.isSystem
      })),
      ungrouped: [...this.state.ungrouped]
    };
  }

  public async save(): Promise<void> {
    this.state = this.normalize(this.state);
    await this.workspaceState.update(STATE_KEY, this.snapshot());
  }

  public listGroups(): GroupRecord[] {
    return this.state.groups.map((group) => ({ ...group, files: [...group.files] }));
  }

  public listUngrouped(): string[] {
    return [...this.state.ungrouped];
  }

  public hasFile(uri: string): boolean {
    if (this.state.ungrouped.includes(uri)) {
      return true;
    }

    return this.state.groups.some((group) => group.files.includes(uri));
  }

  public getGroupById(groupId: string): GroupRecord | undefined {
    const found = this.state.groups.find((group) => group.id === groupId);
    if (!found) {
      return undefined;
    }

    return { ...found, files: [...found.files] };
  }

  public getFileGroupId(uri: string): string | undefined {
    const group = this.state.groups.find((entry) => entry.files.includes(uri));
    return group?.id;
  }

  public addOrKeepInUngrouped(uri: string): void {
    if (this.getFileGroupId(uri)) {
      return;
    }

    if (!this.state.ungrouped.includes(uri)) {
      this.state.ungrouped.push(uri);
    }
  }

  public createGroup(name: string): GroupRecord {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const group: GroupRecord = { id, name, files: [] };
    this.state.groups.push(group);
    return { ...group, files: [] };
  }

  public renameGroup(groupId: string, name: string): boolean {
    const group = this.state.groups.find((entry) => entry.id === groupId);
    if (!group || group.isSystem) {
      return false;
    }

    group.name = name;
    return true;
  }

  public deleteGroup(groupId: string): boolean {
    const index = this.state.groups.findIndex((entry) => entry.id === groupId);
    if (index < 0) {
      return false;
    }

    if (this.state.groups[index].isSystem) {
      return false;
    }

    const removed = this.state.groups[index];
    this.state.groups.splice(index, 1);

    for (const file of removed.files) {
      if (!this.hasFile(file)) {
        this.state.ungrouped.push(file);
      }
    }

    this.state.ungrouped = dedupe(this.state.ungrouped);
    return true;
  }

  public moveToGroup(uri: string, targetGroupId: string): boolean {
    const group = this.state.groups.find((entry) => entry.id === targetGroupId);
    if (!group) {
      return false;
    }

    this.removeFileEverywhere(uri);
    group.files.push(uri);
    group.files = dedupe(group.files);
    return true;
  }

  public removeFromGroup(uri: string): boolean {
    const group = this.state.groups.find((entry) => entry.files.includes(uri));
    if (!group) {
      return false;
    }

    group.files = group.files.filter((file) => file !== uri);
    this.addOrKeepInUngrouped(uri);
    return true;
  }

  public getAllTrackedUris(): string[] {
    const uris = new Set<string>();
    for (const uri of this.state.ungrouped) {
      uris.add(uri);
    }
    for (const group of this.state.groups) {
      for (const uri of group.files) {
        uris.add(uri);
      }
    }
    return Array.from(uris);
  }

  public removeFileCompletely(uri: string): void {
    this.state.ungrouped = this.state.ungrouped.filter((file) => file !== uri);
    for (const group of this.state.groups) {
      group.files = group.files.filter((file) => file !== uri);
    }
  }

  /** Remove all non-system groups that have no files */
  public removeEmptyGroups(): void {
    this.state.groups = this.state.groups.filter(
      (g) => g.isSystem || g.files.length > 0
    );
  }

  private removeFileEverywhere(uri: string): void {
    this.state.ungrouped = this.state.ungrouped.filter((file) => file !== uri);
    for (const group of this.state.groups) {
      group.files = group.files.filter((file) => file !== uri);
    }
  }

  // ─── History group ────────────────────────────────────────────────────────────

  private ensureHistoryGroup(): GroupRecord {
    let history = this.state.groups.find((g) => g.id === HISTORY_GROUP_ID);
    if (!history) {
      history = { id: HISTORY_GROUP_ID, name: HISTORY_GROUP_NAME, files: [], isSystem: true };
      this.state.groups.push(history);
    }
    return history;
  }

  public moveToHistory(uri: string): void {
    const history = this.ensureHistoryGroup();
    if (history.files.includes(uri)) {
      return;
    }
    this.removeFileEverywhere(uri);
    history.files.push(uri);
    // Keep only the 10 most-recently closed files (trim oldest from the front)
    if (history.files.length > 10) {
      history.files = history.files.slice(history.files.length - 10);
    }
  }

  // ─── Auto-grouping by path ─────────────────────────────────────────────────────

  public autoGroupByPath(): void {
    // Collect all non-history tracked files
    const allFiles = [
      ...this.state.ungrouped,
      ...this.state.groups
        .filter((g) => g.id !== HISTORY_GROUP_ID)
        .flatMap((g) => g.files)
    ];

    // Remove all non-system groups and clear ungrouped
    this.state.groups = this.state.groups.filter((g) => g.isSystem);
    this.state.ungrouped = [];

    if (allFiles.length === 0) {
      return;
    }

    const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;

    // First pass: assign each file to its first-level subfolder key
    const firstLevelMap = new Map<string, string[]>();
    const ungroupedFiles: string[] = [];

    for (const uriString of allFiles) {
      const uri = vscode.Uri.parse(uriString);
      const folder = vscode.workspace.getWorkspaceFolder(uri);

      if (!folder) {
        ungroupedFiles.push(uriString);
        continue;
      }

      const rel = vscode.workspace.asRelativePath(uri, false);
      const parts = rel.split('/');

      const key =
        parts.length <= 1
          ? multiRoot ? folder.name : '(root)'
          : multiRoot ? `${folder.name}/${parts[0]}` : parts[0];

      const bucket = firstLevelMap.get(key) ?? [];
      bucket.push(uriString);
      firstLevelMap.set(key, bucket);
    }

    // Second pass: if a first-level group has > 10 files, check if splitting is worthwhile
    // Only split when file count >= 2.5 * second-level subfolder count
    const finalGroupMap = new Map<string, string[]>();

    for (const [groupKey, files] of firstLevelMap) {
      if (files.length > 10) {
        // Count second-level subfolders first
        const subFolderCounts = new Map<string, string[]>();
        for (const uriString of files) {
          const uri = vscode.Uri.parse(uriString);
          const folder = vscode.workspace.getWorkspaceFolder(uri)!;
          const rel = vscode.workspace.asRelativePath(uri, false);
          const parts = rel.split('/');

          const subKey =
            parts.length <= 2
              ? groupKey
              : multiRoot
                ? `${folder.name}/${parts[0]}/${parts[1]}`
                : `${parts[0]}/${parts[1]}`;

          const bucket = subFolderCounts.get(subKey) ?? [];
          bucket.push(uriString);
          subFolderCounts.set(subKey, bucket);
        }

        // Only split if file count >= 2.5 * second-level subfolder count
        if (files.length >= subFolderCounts.size * 2.5) {
          for (const [subKey, subFiles] of subFolderCounts) {
            finalGroupMap.set(subKey, subFiles);
          }
        } else {
          finalGroupMap.set(groupKey, files);
        }
      } else {
        const bucket = finalGroupMap.get(groupKey) ?? [];
        bucket.push(...files);
        finalGroupMap.set(groupKey, bucket);
      }
    }

    // Create new groups from the computed map
    for (const [name, files] of finalGroupMap) {
      const created = this.createGroup(name);
      const ref = this.state.groups.find((g) => g.id === created.id)!;
      ref.files = files;
    }

    this.state.ungrouped = ungroupedFiles;
  }
}
