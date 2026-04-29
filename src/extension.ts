import * as vscode from 'vscode';
import { FileDragAndDropController, FileTreeItem, GroupTreeItem, OpenedFilesProvider } from './provider';
import { GroupStateStore, HISTORY_GROUP_ID } from './state';

function collectOpenFileUris(): Set<string> {
  const uris = new Set<string>();

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

async function syncFromTabs(provider: OpenedFilesProvider): Promise<void> {
  const openUris = collectOpenFileUris();
  let changed = false;

  for (const uri of openUris) {
    // If a History file is now open again, restore it to Ungrouped
    const currentGroupId = provider.getStore().getFileGroupId(uri);
    if (currentGroupId === HISTORY_GROUP_ID) {
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

function normalizeGroupName(name: string): string {
  return name.trim();
}

export function activate(context: vscode.ExtensionContext): void {
  const store = new GroupStateStore(context.workspaceState);
  const provider = new OpenedFilesProvider(store);

  const dndController = new FileDragAndDropController(
    store,
    () => provider.refresh(),
    () => provider.persist()
  );

  const view = vscode.window.createTreeView('smartOpenedFilesView', {
    treeDataProvider: provider,
    showCollapseAll: true,
    dragAndDropController: dndController
  });

  context.subscriptions.push(view);

  const register = (command: string, callback: (...args: any[]) => unknown) => {
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

  register('smartOpenedFiles.renameGroup', async (item?: GroupTreeItem) => {
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

  register('smartOpenedFiles.deleteGroup', async (item?: GroupTreeItem) => {
    if (!item) {
      return;
    }

    const result = await vscode.window.showWarningMessage(
      `Delete group \"${item.group.name}\"? Files will be moved to Ungrouped.`,
      { modal: true },
      'Delete'
    );

    if (result !== 'Delete') {
      return;
    }

    store.deleteGroup(item.group.id);
    await provider.persist();
    provider.refresh();
  });

  register('smartOpenedFiles.moveFileToGroup', async (item?: FileTreeItem) => {
    if (!item) {
      return;
    }

    const groups = store.listGroups().filter((g) => !g.isSystem);
    if (groups.length === 0) {
      vscode.window.showInformationMessage('No group exists yet. Create a group first.');
      return;
    }

    const selected = await vscode.window.showQuickPick(
      groups
        .filter((group) => group.id !== item.groupId)
        .map((group) => ({ label: group.name, id: group.id })),
      {
        title: 'Move File To Group',
        placeHolder: 'Select target group',
        ignoreFocusOut: true
      }
    );

    if (!selected) {
      return;
    }

    store.moveToGroup(item.uriString, selected.id);
    await provider.persist();
    provider.refresh();
  });

  register('smartOpenedFiles.removeFromGroup', async (item?: FileTreeItem) => {
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

  register('smartOpenedFiles.openFile', async (item?: FileTreeItem) => {
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
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Cannot open file: ${reason}`);
    }
  });

  register('smartOpenedFiles.closeFile', async (item?: FileTreeItem) => {
    if (!item) {
      return;
    }

    const targetUri = item.uriString;
    const tabsToClose: vscode.Tab[] = [];

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
    const nonHistoryCount =
      store.listGroups().filter((g) => !g.isSystem).reduce((acc, g) => acc + g.files.length, 0) +
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

  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(async (event) => {
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
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document.uri.scheme !== 'untitled') {
        await syncFromTabs(provider);
      }
    })
  );

  void syncFromTabs(provider);
}

export function deactivate(): void {
  // No-op.
}
