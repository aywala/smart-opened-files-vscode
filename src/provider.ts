import * as path from 'path';
import * as vscode from 'vscode';
import { GroupRecord, GroupStateStore } from './state';

export class GroupTreeItem extends vscode.TreeItem {
  constructor(public readonly group: GroupRecord) {
    super(group.name, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'smartOpenedFiles.group';
    this.description = `${group.files.length}`;
    this.tooltip = `${group.name} (${group.files.length})`;
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

export class UngroupedTreeItem extends vscode.TreeItem {
  constructor(public readonly filesCount: number) {
    super('Ungrouped', vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'smartOpenedFiles.ungrouped';
    this.description = `${filesCount}`;
    this.tooltip = `Ungrouped (${filesCount})`;
    this.iconPath = new vscode.ThemeIcon('files');
  }
}

export class FileTreeItem extends vscode.TreeItem {
  public readonly uriString: string;
  public readonly groupId?: string;

  constructor(uriString: string, options: { groupId?: string; isOpen: boolean; workspaceFolderName?: string }) {
    const uri = vscode.Uri.parse(uriString);
    const fileName = path.basename(uri.path) || uri.path || uriString;

    super(fileName, vscode.TreeItemCollapsibleState.None);

    this.uriString = uriString;
    this.groupId = options.groupId;
    this.resourceUri = uri;
    this.command = {
      command: 'smartOpenedFiles.openFile',
      title: 'Open File',
      arguments: [this]
    };

    this.contextValue = groupIdToContextValue(options.groupId);
    this.description = buildDescription(uri, options.workspaceFolderName, options.isOpen);
    this.tooltip = `${uri.fsPath || uri.toString()}`;
    this.iconPath = options.isOpen ? new vscode.ThemeIcon('file') : new vscode.ThemeIcon('circle-outline');
  }
}

function groupIdToContextValue(groupId?: string): string {
  if (groupId) {
    return 'smartOpenedFiles.file.inGroup';
  }

  return 'smartOpenedFiles.file.ungrouped';
}

function buildDescription(uri: vscode.Uri, workspaceFolderName: string | undefined, isOpen: boolean): string {
  const segments: string[] = [];
  const workspaceRelative = vscode.workspace.asRelativePath(uri, false);

  if (workspaceRelative && workspaceRelative !== uri.path) {
    segments.push(workspaceRelative);
  } else if (uri.scheme !== 'file') {
    segments.push(uri.toString());
  }

  if (workspaceFolderName) {
    segments.push(workspaceFolderName);
  }

  if (!isOpen) {
    segments.push('closed');
  }

  return segments.join(' • ');
}

export class OpenedFilesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private openUris = new Set<string>();

  constructor(private readonly store: GroupStateStore) {}

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public updateOpenUris(uris: Set<string>): void {
    this.openUris = uris;
    this.refresh();
  }

  public ensureTracked(uri: string): boolean {
    const existed = this.store.hasFile(uri);
    this.store.addOrKeepInUngrouped(uri);
    return !existed;
  }

  public async persist(): Promise<void> {
    await this.store.save();
  }

  public getStore(): GroupStateStore {
    return this.store;
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    if (!element) {
      const groups = this.store
        .listGroups()
        .sort((a, b) => a.name.localeCompare(b.name, 'en'))
        .map((group) => new GroupTreeItem(group));

      const ungrouped = new UngroupedTreeItem(this.store.listUngrouped().length);
      return [...groups, ungrouped];
    }

    if (element instanceof GroupTreeItem) {
      return this.buildFileItems(element.group.files, element.group.id);
    }

    if (element instanceof UngroupedTreeItem) {
      return this.buildFileItems(this.store.listUngrouped(), undefined);
    }

    return [];
  }

  private buildFileItems(uris: string[], groupId?: string): FileTreeItem[] {
    const sorted = [...uris].sort((a, b) => this.fileLabel(a).localeCompare(this.fileLabel(b), 'en'));

    return sorted.map((uriString) => {
      const uri = vscode.Uri.parse(uriString);
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

      return new FileTreeItem(uriString, {
        groupId,
        isOpen: this.openUris.has(uriString),
        workspaceFolderName: workspaceFolder?.name
      });
    });
  }

  private fileLabel(uriString: string): string {
    const uri = vscode.Uri.parse(uriString);
    return path.basename(uri.path) || uri.path || uriString;
  }
}
