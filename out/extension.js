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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const provider_1 = require("./provider");
const state_1 = require("./state");
function collectOpenFileUris() {
    const uris = new Set();
    for (const tabGroup of vscode.window.tabGroups.all) {
        for (const tab of tabGroup.tabs) {
            const input = tab.input;
            if (input instanceof vscode.TabInputText) {
                uris.add(input.uri.toString());
            }
        }
    }
    return uris;
}
async function syncFromTabs(provider) {
    const openUris = collectOpenFileUris();
    let changed = false;
    for (const uri of openUris) {
        // If a History file is now open again, restore it to Ungrouped
        const currentGroupId = provider.getStore().getFileGroupId(uri);
        if (currentGroupId === state_1.HISTORY_GROUP_ID) {
            provider.getStore().removeFromGroup(uri);
            changed = true;
        }
        if (provider.ensureTracked(uri)) {
            changed = true;
        }
    }
    provider.updateOpenUris(openUris);
    if (changed) {
        await provider.persist();
    }
}
function normalizeGroupName(name) {
    return name.trim();
}
function activate(context) {
    const store = new state_1.GroupStateStore(context.workspaceState);
    const provider = new provider_1.OpenedFilesProvider(store);
    const dndController = new provider_1.FileDragAndDropController(store, () => provider.refresh(), () => provider.persist());
    const view = vscode.window.createTreeView('smartOpenedFilesView', {
        treeDataProvider: provider,
        showCollapseAll: true,
        dragAndDropController: dndController
    });
    context.subscriptions.push(view);
    const register = (command, callback) => {
        context.subscriptions.push(vscode.commands.registerCommand(command, callback));
    };
    register('smartOpenedFiles.refresh', async () => {
        await syncFromTabs(provider);
    });
    register('smartOpenedFiles.createGroup', async () => {
        const input = await vscode.window.showInputBox({
            title: 'Create Group',
            prompt: 'Enter group name',
            ignoreFocusOut: true,
            validateInput: (value) => (normalizeGroupName(value) ? undefined : 'Group name is required')
        });
        if (input === undefined) {
            return;
        }
        const name = normalizeGroupName(input);
        store.createGroup(name);
        await provider.persist();
        provider.refresh();
    });
    register('smartOpenedFiles.renameGroup', async (item) => {
        if (!item) {
            return;
        }
        const input = await vscode.window.showInputBox({
            title: 'Rename Group',
            value: item.group.name,
            prompt: 'Enter new group name',
            ignoreFocusOut: true,
            validateInput: (value) => (normalizeGroupName(value) ? undefined : 'Group name is required')
        });
        if (input === undefined) {
            return;
        }
        const name = normalizeGroupName(input);
        store.renameGroup(item.group.id, name);
        await provider.persist();
        provider.refresh();
    });
    register('smartOpenedFiles.deleteGroup', async (item) => {
        if (!item) {
            return;
        }
        const result = await vscode.window.showWarningMessage(`Delete group \"${item.group.name}\"? Files will be moved to Ungrouped.`, { modal: true }, 'Delete');
        if (result !== 'Delete') {
            return;
        }
        store.deleteGroup(item.group.id);
        await provider.persist();
        provider.refresh();
    });
    register('smartOpenedFiles.moveFileToGroup', async (item) => {
        if (!item) {
            return;
        }
        const groups = store.listGroups().filter((g) => !g.isSystem);
        if (groups.length === 0) {
            vscode.window.showInformationMessage('No group exists yet. Create a group first.');
            return;
        }
        const selected = await vscode.window.showQuickPick(groups
            .filter((group) => group.id !== item.groupId)
            .map((group) => ({ label: group.name, id: group.id })), {
            title: 'Move File To Group',
            placeHolder: 'Select target group',
            ignoreFocusOut: true
        });
        if (!selected) {
            return;
        }
        store.moveToGroup(item.uriString, selected.id);
        await provider.persist();
        provider.refresh();
    });
    register('smartOpenedFiles.removeFromGroup', async (item) => {
        if (!item) {
            return;
        }
        if (!item.groupId) {
            return;
        }
        store.removeFromGroup(item.uriString);
        await provider.persist();
        provider.refresh();
    });
    register('smartOpenedFiles.openFile', async (item) => {
        if (!item) {
            return;
        }
        try {
            const uri = vscode.Uri.parse(item.uriString);
            await vscode.window.showTextDocument(uri, {
                preview: false,
                preserveFocus: false
            });
            await syncFromTabs(provider);
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Cannot open file: ${reason}`);
        }
    });
    register('smartOpenedFiles.closeFile', async (item) => {
        if (!item) {
            return;
        }
        const targetUri = item.uriString;
        const tabsToClose = [];
        for (const tabGroup of vscode.window.tabGroups.all) {
            for (const tab of tabGroup.tabs) {
                const input = tab.input;
                if (input instanceof vscode.TabInputText && input.uri.toString() === targetUri) {
                    tabsToClose.push(tab);
                }
            }
        }
        if (tabsToClose.length === 0) {
            vscode.window.showInformationMessage('File is already closed.');
            return;
        }
        await vscode.window.tabGroups.close(tabsToClose, true);
        await syncFromTabs(provider);
    });
    register('smartOpenedFiles.autoGroup', async () => {
        const nonHistoryCount = store.listGroups().filter((g) => !g.isSystem).reduce((acc, g) => acc + g.files.length, 0) +
            store.listUngrouped().length;
        if (nonHistoryCount === 0) {
            vscode.window.showInformationMessage('No files to group.');
            return;
        }
        store.autoGroupByPath();
        await provider.persist();
        provider.refresh();
        vscode.window.showInformationMessage('Files grouped by path successfully.');
    });
    context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(async (event) => {
        // Move closed files to the History group
        let historyChanged = false;
        for (const tab of event.closed) {
            const input = tab.input;
            if (input instanceof vscode.TabInputText) {
                const uri = input.uri.toString();
                if (store.hasFile(uri)) {
                    store.moveToHistory(uri);
                    historyChanged = true;
                }
            }
        }
        await syncFromTabs(provider);
        // Ensure history moves are persisted even when syncFromTabs detects no other changes
        if (historyChanged) {
            await provider.persist();
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (document.uri.scheme !== 'untitled') {
            await syncFromTabs(provider);
        }
    }));
    void syncFromTabs(provider);
}
function deactivate() {
    // No-op.
}
//# sourceMappingURL=extension.js.map