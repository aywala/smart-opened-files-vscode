"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupStateStore = void 0;
const STATE_KEY = 'smartOpenedFiles.state.v1';
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
            files: dedupe(group.files ?? [])
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
                files: [...group.files]
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
        if (!group) {
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
}
exports.GroupStateStore = GroupStateStore;
//# sourceMappingURL=state.js.map