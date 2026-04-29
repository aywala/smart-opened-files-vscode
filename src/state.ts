import * as vscode from 'vscode';

const STATE_KEY = 'smartOpenedFiles.state.v1';

export interface GroupRecord {
  id: string;
  name: string;
  files: string[];
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
      files: dedupe(group.files ?? [])
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
        files: [...group.files]
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
    if (!group) {
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

  private removeFileEverywhere(uri: string): void {
    this.state.ungrouped = this.state.ungrouped.filter((file) => file !== uri);
    for (const group of this.state.groups) {
      group.files = group.files.filter((file) => file !== uri);
    }
  }
}
