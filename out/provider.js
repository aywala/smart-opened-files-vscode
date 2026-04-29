"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenedFilesProvider = exports.FileTreeItem = exports.UngroupedTreeItem = exports.GroupTreeItem = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
class GroupTreeItem extends vscode.TreeItem {
    constructor(group) {
        super(group.name, vscode.TreeItemCollapsibleState.Expanded);
        this.group = group;
        this.contextValue = 'smartOpenedFiles.group';
        this.description = `${group.files.length}`;
        this.tooltip = `${group.name} (${group.files.length})`;
        this.iconPath = new vscode.ThemeIcon('folder');
    }
}
exports.GroupTreeItem = GroupTreeItem;
class UngroupedTreeItem extends vscode.TreeItem {
    constructor(filesCount) {
        super('Ungrouped', vscode.TreeItemCollapsibleState.Expanded);
        this.filesCount = filesCount;
        this.contextValue = 'smartOpenedFiles.ungrouped';
        this.description = `${filesCount}`;
        this.tooltip = `Ungrouped (${filesCount})`;
        this.iconPath = new vscode.ThemeIcon('files');
    }
}
exports.UngroupedTreeItem = UngroupedTreeItem;
class FileTreeItem extends vscode.TreeItem {
    constructor(uriString, options) {
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
exports.FileTreeItem = FileTreeItem;
function groupIdToContextValue(groupId) {
    if (groupId) {
        return 'smartOpenedFiles.file.inGroup';
    }
    return 'smartOpenedFiles.file.ungrouped';
}
function buildDescription(uri, workspaceFolderName, isOpen) {
    const segments = [];
    const workspaceRelative = vscode.workspace.asRelativePath(uri, false);
    if (workspaceRelative && workspaceRelative !== uri.path) {
        segments.push(workspaceRelative);
    }
    else if (uri.scheme !== 'file') {
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
class OpenedFilesProvider {
    constructor(store) {
        this.store = store;
        this.onDidChangeTreeDataEmitter = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
        this.openUris = new Set();
    }
    refresh() {
        this.onDidChangeTreeDataEmitter.fire(undefined);
    }
    updateOpenUris(uris) {
        this.openUris = uris;
        this.refresh();
    }
    ensureTracked(uri) {
        const existed = this.store.hasFile(uri);
        this.store.addOrKeepInUngrouped(uri);
        return !existed;
    }
    async persist() {
        await this.store.save();
    }
    getStore() {
        return this.store;
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
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
    buildFileItems(uris, groupId) {
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
    fileLabel(uriString) {
        const uri = vscode.Uri.parse(uriString);
        return path.basename(uri.path) || uri.path || uriString;
    }
}
exports.OpenedFilesProvider = OpenedFilesProvider;
//# sourceMappingURL=provider.js.map