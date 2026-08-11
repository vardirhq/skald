import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { Vault } from './vault';
import { SyncEngine } from './sync';
import { GitHubService } from './github';
import { loadAppConfig, saveAppConfig } from './config';
import type { VaultSettings } from '../src-shared/types';
import type { TaskEdits } from '../src-shared/tasks';

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let vault: Vault | null = null;
let sync: SyncEngine | null = null;
const github = new GitHubService();

protocol.registerSchemesAsPrivileged([
  { scheme: 'skald-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function appIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icons', '256x256.png')
    : join(__dirname, '../build/icons/256x256.png');
}

function createWindow() {
  const cfg = loadAppConfig();
  mainWindow = new BrowserWindow({
    width: cfg.windowBounds?.width ?? 1440,
    height: cfg.windowBounds?.height ?? 920,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    icon: appIconPath(),
    backgroundColor: '#0a0c10',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false));
  mainWindow.on('resize', () => {
    if (!mainWindow || mainWindow.isMaximized()) return;
    const [width, height] = mainWindow.getSize();
    saveAppConfig({ windowBounds: { width, height } });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

async function openVault(path: string, seedIfEmpty = false): Promise<unknown> {
  sync?.dispose();
  sync = null;
  await vault?.close();
  vault = new Vault(
    path,
    (snapshot) => {
      mainWindow?.webContents.send('vault:changed', snapshot);
      // A local edit is a reason to publish, but only once the burst settles.
      sync?.scheduleSync();
    },
    // Attachments are not indexed, so they never reach the snapshot callback.
    () => sync?.scheduleSync()
  );
  await vault.open();
  if (seedIfEmpty && vault.snapshot().notes.length === 0) {
    await vault.seed();
  }
  sync = new SyncEngine({
    vault,
    onStatus: (status) => mainWindow?.webContents.send('sync:changed', status),
  });
  saveAppConfig({ lastVault: path });
  return vault.snapshot();
}

function requireVault(): Vault {
  if (!vault) throw new Error('No vault open');
  return vault;
}

function requireSync(): SyncEngine {
  if (!sync) throw new Error('No vault open');
  return sync;
}

app.whenReady().then(() => {
  protocol.handle('skald-asset', (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'vault') return new Response('Not found', { status: 404 });
      const path = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      return net.fetch(pathToFileURL(requireVault().resolveVaultFile(path)).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  sync?.dispose();
  await vault?.close();
});

function registerIpc() {
  // ----- vault lifecycle -----
  ipcMain.handle('vault:getLast', () => {
    const last = loadAppConfig().lastVault;
    return last && existsSync(last) ? last : null;
  });

  ipcMain.handle('vault:selectDialog', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open vault folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('vault:open', (_e, path: string) => openVault(path, false));
  ipcMain.handle('vault:create', (_e, path: string) => openVault(path, true));
  ipcMain.handle('vault:snapshot', () => requireVault().snapshot());
  ipcMain.handle('vault:revealInFolder', (_e, sub?: string) => {
    const v = requireVault();
    shell.openPath(sub ? join(v.path, sub) : v.path);
  });
  // Opening a note's own folder with the file selected, rather than handing the
  // Markdown file to whatever the desktop thinks should edit it.
  ipcMain.handle('vault:showItem', (_e, path: string) => {
    shell.showItemInFolder(requireVault().resolveVaultFile(path));
  });

  // ----- notes -----
  ipcMain.handle('note:read', (_e, path: string) => requireVault().readNote(path));
  ipcMain.handle('note:write', (_e, path: string, content: string) =>
    requireVault().writeNote(path, content)
  );
  ipcMain.handle('note:create', (_e, folder: string, title: string, schema: string) =>
    requireVault().createNote(folder, title, schema as never)
  );
  ipcMain.handle('note:createDaily', () => requireVault().createDailyNote());
  ipcMain.handle('note:rename', (_e, path: string, newTitle: string) =>
    requireVault().renameNote(path, newTitle)
  );
  ipcMain.handle('note:moveMany', (_e, paths: string[], folder: string) =>
    requireVault().moveNotes(paths, folder)
  );
  ipcMain.handle('note:delete', (_e, path: string) => requireVault().deleteNote(path));
  ipcMain.handle('note:deleteMany', (_e, paths: string[]) => requireVault().deleteNotes(paths));
  ipcMain.handle('note:history:list', (_e, path: string) => requireVault().listNoteHistory(path));
  ipcMain.handle('note:history:read', (_e, path: string, id: string) =>
    requireVault().readNoteHistoryVersion(path, id)
  );
  ipcMain.handle('note:history:restore', (_e, path: string, id: string) =>
    requireVault().restoreNoteHistoryVersion(path, id)
  );
  ipcMain.handle('folder:create', (_e, path: string) => requireVault().createFolder(path));
  ipcMain.handle('folder:move', (_e, path: string, parent: string) =>
    requireVault().moveFolder(path, parent)
  );
  ipcMain.handle('folder:rename', (_e, path: string, name: string) =>
    requireVault().renameFolder(path, name)
  );
  ipcMain.handle('folder:delete', (_e, path: string) => requireVault().deleteFolder(path));
  ipcMain.handle('search:query', (_e, query: string) => requireVault().search(query));
  ipcMain.handle('trash:list', () => requireVault().listDeletedNotes());
  ipcMain.handle('trash:restore', (_e, path: string) => requireVault().restoreDeletedNote(path));

  // ----- attachments -----
  ipcMain.handle('attachment:select', async (_e, notePath: string) => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Attach files',
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? [] : requireVault().importAttachmentPaths(notePath, result.filePaths);
  });
  ipcMain.handle('attachment:importPaths', (_e, notePath: string, paths: string[]) =>
    requireVault().importAttachmentPaths(notePath, paths)
  );
  ipcMain.handle(
    'attachment:importData',
    (_e, notePath: string, fileName: string, mime: string, bytes: number[] | Uint8Array) =>
      requireVault().importAttachmentData(notePath, fileName, mime, bytes)
  );
  ipcMain.handle('attachment:open', (_e, path: string) =>
    shell.openPath(requireVault().resolveVaultFile(path))
  );
  ipcMain.handle('attachment:reveal', (_e, path: string) => {
    shell.showItemInFolder(requireVault().resolveVaultFile(path));
  });

  // ----- tasks -----
  ipcMain.handle('task:update', (_e, id: string, edits: TaskEdits) =>
    requireVault().updateTask(id, edits)
  );
  ipcMain.handle(
    'task:add',
    (_e, notePath: string, content: string, opts?: { due?: string | null; priority?: 'low' | 'med' | 'high' }) =>
      requireVault().addTask(notePath, content, opts ?? {})
  );

  // ----- settings / graph -----
  ipcMain.handle('settings:set', (_e, patch: Partial<VaultSettings>) =>
    requireVault().setSettings(patch)
  );
  ipcMain.handle('graph:setPosition', (_e, path: string, x: number, y: number) =>
    requireVault().setGraphPosition(path, x, y)
  );
  ipcMain.handle('graph:resetLayout', () => requireVault().resetGraphLayout());

  // ----- sync -----
  //
  // Sync is the one surface that talks to a machine we do not control, so a
  // failure here gets logged where a person running the app can see it as well
  // as returned to the renderer. A rejected invoke on its own leaves no trace.
  const syncHandle = <A extends unknown[], R>(
    channel: string,
    handler: (...args: A) => R | Promise<R>
  ): void => {
    ipcMain.handle(channel, async (_e, ...args) => {
      try {
        return await handler(...(args as A));
      } catch (err) {
        console.error(`skald: ${channel} failed —`, err instanceof Error ? err.message : err);
        throw err;
      }
    });
  };

  syncHandle('sync:status', () => requireSync().status());
  syncHandle('sync:connect', (input: { serverUrl: string; handle?: string; provisioningSecret?: string }) =>
    requireSync().connect(input)
  );
  syncHandle('sync:pair', (uri: string) => requireSync().pair(uri));
  syncHandle('sync:mintPairing', () => requireSync().mintPairing());
  syncHandle('sync:devices', () => requireSync().listDevices());
  syncHandle('sync:revoke', (deviceId: string) => requireSync().revokeDevice(deviceId));
  syncHandle('sync:now', () => requireSync().syncNow());
  syncHandle('sync:snapshot', () => requireSync().pushSnapshot());
  syncHandle('sync:setEnabled', (enabled: boolean) => requireSync().setEnabled(enabled));
  syncHandle('sync:disconnect', () => requireSync().disconnect());

  // ----- GitHub -----
  // Access tokens stay behind this boundary. The renderer only receives
  // connection state and the small, normalized repository-card model.
  syncHandle('github:status', () => github.status());
  syncHandle('github:login:begin', () => github.beginLogin());
  syncHandle('github:login:complete', () => github.completeLogin());
  syncHandle('github:login:cancel', () => github.cancelLogin());
  syncHandle('github:disconnect', () => github.disconnect());
  syncHandle('github:repository', (repo: string, force?: boolean) =>
    github.repository(repo, force)
  );

  // ----- window controls -----
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
  ipcMain.handle('window:close', () => mainWindow?.close());
}
