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
exports.FileDragAndDropController = exports.OpenedFilesProvider = exports.FileTreeItem = exports.UngroupedTreeItem = exports.GroupTreeItem = exports.TREE_MIME_TYPE = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const state_1 = require("./state");
exports.TREE_MIME_TYPE = 'application/vnd.code.tree.smartopenedfilesview';
class GroupTreeItem extends vscode.TreeItem {
    constructor(group) {
        super(group.name, vscode.TreeItemCollapsibleState.Expanded);
        this.group = group;
        if (group.isSystem) {
            this.contextValue = 'smartOpenedFiles.group.system';
            this.iconPath = new vscode.ThemeIcon('history');
        }
        else {
            this.contextValue = 'smartOpenedFiles.group';
            this.iconPath = new vscode.ThemeIcon('folder');
        }
        this.description = `${group.files.length}`;
        this.tooltip = `${group.name} (${group.files.length})`;
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
            const allGroups = this.store.listGroups();
            // Regular groups (non-system) sorted A-Z
            const regularGroups = allGroups
                .filter((g) => !g.isSystem)
                .sort((a, b) => a.name.localeCompare(b.name, 'en'))
                .map((g) => new GroupTreeItem(g));
            // Ungrouped container always visible
            const ungrouped = new UngroupedTreeItem(this.store.listUngrouped().length);
            // History group at the bottom, only shown when it has files
            const historyRecord = allGroups.find((g) => g.id === state_1.HISTORY_GROUP_ID);
            const historyItems = historyRecord && historyRecord.files.length > 0 ? [new GroupTreeItem(historyRecord)] : [];
            return [...regularGroups, ungrouped, ...historyItems];
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
class FileDragAndDropController {
    constructor(store, onRefresh, onPersist) {
        this.store = store;
        this.onRefresh = onRefresh;
        this.onPersist = onPersist;
        this.dragMimeTypes = [exports.TREE_MIME_TYPE];
        this.dropMimeTypes = [exports.TREE_MIME_TYPE];
    }
    handleDrag(source, dataTransfer) {
        const uris = source
            .filter((item) => item instanceof FileTreeItem)
            .map((item) => item.uriString);
        if (uris.length > 0) {
            dataTransfer.set(exports.TREE_MIME_TYPE, new vscode.DataTransferItem(uris));
        }
    }
    async handleDrop(target, dataTransfer) {
        const transferItem = dataTransfer.get(exports.TREE_MIME_TYPE);
        if (!transferItem) {
            return;
        }
        const uris = transferItem.value;
        if (!Array.isArray(uris) || uris.length === 0) {
            return;
        }
        const fileUris = uris.filter((u) => typeof u === 'string');
        let changed = false;
        if (target instanceof GroupTreeItem) {
            // Block manual drops into the History system group
            if (target.group.id === state_1.HISTORY_GROUP_ID) {
                return;
            }
            for (const uri of fileUris) {
                if (this.store.moveToGroup(uri, target.group.id)) {
                    changed = true;
                }
            }
        }
        else if (target instanceof FileTreeItem) {
            // Dropped onto a file: move to that file's container
            if (target.groupId && target.groupId !== state_1.HISTORY_GROUP_ID) {
                for (const uri of fileUris) {
                    if (uri !== target.uriString && this.store.moveToGroup(uri, target.groupId)) {
                        changed = true;
                    }
                }
            }
            else if (!target.groupId) {
                // Target file is in Ungrouped
                for (const uri of fileUris) {
                    if (uri !== target.uriString && this.store.getFileGroupId(uri)) {
                        this.store.removeFromGroup(uri);
                        changed = true;
                    }
                }
            }
        }
        else if (target instanceof UngroupedTreeItem || target === undefined) {
            for (const uri of fileUris) {
                if (this.store.getFileGroupId(uri)) {
                    this.store.removeFromGroup(uri);
                    changed = true;
                }
            }
        }
        if (changed) {
            await this.onPersist();
            this.onRefresh();
        }
    }
}
exports.FileDragAndDropController = FileDragAndDropController;
//# sourceMappingURL=provider.js.map