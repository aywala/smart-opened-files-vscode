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
exports.GroupStateStore = exports.HISTORY_GROUP_ID = void 0;
const vscode = __importStar(require("vscode"));
const STATE_KEY = 'smartOpenedFiles.state.v1';
exports.HISTORY_GROUP_ID = '__history__';
const HISTORY_GROUP_NAME = 'History';
function dedupe(values) {
    return Array.from(new Set(values));
}
class GroupStateStore {
    constructor(workspaceState) {
        this.workspaceState = workspaceState;
        const raw = workspaceState.get(STATE_KEY);
        this.state = this.normalize(raw);
    }
    normalize(raw) {
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
    snapshot() {
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
    async save() {
        this.state = this.normalize(this.state);
        await this.workspaceState.update(STATE_KEY, this.snapshot());
    }
    listGroups() {
        return this.state.groups.map((group) => ({ ...group, files: [...group.files] }));
    }
    listUngrouped() {
        return [...this.state.ungrouped];
    }
    hasFile(uri) {
        if (this.state.ungrouped.includes(uri)) {
            return true;
        }
        return this.state.groups.some((group) => group.files.includes(uri));
    }
    getGroupById(groupId) {
        const found = this.state.groups.find((group) => group.id === groupId);
        if (!found) {
            return undefined;
        }
        return { ...found, files: [...found.files] };
    }
    getFileGroupId(uri) {
        const group = this.state.groups.find((entry) => entry.files.includes(uri));
        return group?.id;
    }
    addOrKeepInUngrouped(uri) {
        if (this.getFileGroupId(uri)) {
            return;
        }
        if (!this.state.ungrouped.includes(uri)) {
            this.state.ungrouped.push(uri);
        }
    }
    createGroup(name) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const group = { id, name, files: [] };
        this.state.groups.push(group);
        return { ...group, files: [] };
    }
    renameGroup(groupId, name) {
        const group = this.state.groups.find((entry) => entry.id === groupId);
        if (!group || group.isSystem) {
            return false;
        }
        group.name = name;
        return true;
    }
    deleteGroup(groupId) {
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
    moveToGroup(uri, targetGroupId) {
        const group = this.state.groups.find((entry) => entry.id === targetGroupId);
        if (!group) {
            return false;
        }
        this.removeFileEverywhere(uri);
        group.files.push(uri);
        group.files = dedupe(group.files);
        return true;
    }
    removeFromGroup(uri) {
        const group = this.state.groups.find((entry) => entry.files.includes(uri));
        if (!group) {
            return false;
        }
        group.files = group.files.filter((file) => file !== uri);
        this.addOrKeepInUngrouped(uri);
        return true;
    }
    removeFileEverywhere(uri) {
        this.state.ungrouped = this.state.ungrouped.filter((file) => file !== uri);
        for (const group of this.state.groups) {
            group.files = group.files.filter((file) => file !== uri);
        }
    }
    // ─── History group ────────────────────────────────────────────────────────────
    ensureHistoryGroup() {
        let history = this.state.groups.find((g) => g.id === exports.HISTORY_GROUP_ID);
        if (!history) {
            history = { id: exports.HISTORY_GROUP_ID, name: HISTORY_GROUP_NAME, files: [], isSystem: true };
            this.state.groups.push(history);
        }
        return history;
    }
    moveToHistory(uri) {
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
    autoGroupByPath() {
        // Collect all non-history tracked files
        const allFiles = [
            ...this.state.ungrouped,
            ...this.state.groups
                .filter((g) => g.id !== exports.HISTORY_GROUP_ID)
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
        const firstLevelMap = new Map();
        const ungroupedFiles = [];
        for (const uriString of allFiles) {
            const uri = vscode.Uri.parse(uriString);
            const folder = vscode.workspace.getWorkspaceFolder(uri);
            if (!folder) {
                ungroupedFiles.push(uriString);
                continue;
            }
            const rel = vscode.workspace.asRelativePath(uri, false);
            const parts = rel.split('/');
            const key = parts.length <= 1
                ? multiRoot ? folder.name : '(root)'
                : multiRoot ? `${folder.name}/${parts[0]}` : parts[0];
            const bucket = firstLevelMap.get(key) ?? [];
            bucket.push(uriString);
            firstLevelMap.set(key, bucket);
        }
        // Second pass: if a first-level group has > 10 files, split by second-level subfolder
        const finalGroupMap = new Map();
        for (const [groupKey, files] of firstLevelMap) {
            if (files.length > 10) {
                for (const uriString of files) {
                    const uri = vscode.Uri.parse(uriString);
                    const folder = vscode.workspace.getWorkspaceFolder(uri);
                    const rel = vscode.workspace.asRelativePath(uri, false);
                    const parts = rel.split('/');
                    const subKey = parts.length <= 2
                        ? groupKey
                        : multiRoot
                            ? `${folder.name}/${parts[0]}/${parts[1]}`
                            : `${parts[0]}/${parts[1]}`;
                    const bucket = finalGroupMap.get(subKey) ?? [];
                    bucket.push(uriString);
                    finalGroupMap.set(subKey, bucket);
                }
            }
            else {
                const bucket = finalGroupMap.get(groupKey) ?? [];
                bucket.push(...files);
                finalGroupMap.set(groupKey, bucket);
            }
        }
        // Create new groups from the computed map
        for (const [name, files] of finalGroupMap) {
            const created = this.createGroup(name);
            const ref = this.state.groups.find((g) => g.id === created.id);
            ref.files = files;
        }
        this.state.ungrouped = ungroupedFiles;
    }
}
exports.GroupStateStore = GroupStateStore;
//# sourceMappingURL=state.js.map