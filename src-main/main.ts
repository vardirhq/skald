import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { Vault } from './vault';
import { SyncEngine } from './sync';
import { loadAppConfig, saveAppConfig } from './config';
import type { VaultSettings } from '../src-shared/types';
import type { TaskEdits } from '../src-shared/tasks';

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let vault: Vault | null = null;
let sync: SyncEngine | null = null;

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
  vault = new Vault(path, (snapshot) => {
    mainWindow?.webContents.send('vault:changed', snapshot);
    // A local edit is a reason to publish, but only once the burst settles.
    sync?.scheduleSync();
  });
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
  ipcMain.handle('note:delete', (_e, path: string) => requireVault().deleteNote(path));
  ipcMain.handle('note:history:list', (_e, path: string) => requireVault().listNoteHistory(path));
  ipcMain.handle('note:history:read', (_e, path: string, id: string) =>
    requireVault().readNoteHistoryVersion(path, id)
  );
  ipcMain.handle('note:history:restore', (_e, path: string, id: string) =>
    requireVault().restoreNoteHistoryVersion(path, id)
  );
  ipcMain.handle('folder:create', (_e, path: string) => requireVault().createFolder(path));

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
  ipcMain.handle('sync:status', () => requireSync().status());
  ipcMain.handle('sync:connect', (_e, input: { serverUrl: string; handle?: string; provisioningSecret?: string }) =>
    requireSync().connect(input)
  );
  ipcMain.handle('sync:pair', (_e, uri: string) => requireSync().pair(uri));
  ipcMain.handle('sync:mintPairing', () => requireSync().mintPairing());
  ipcMain.handle('sync:devices', () => requireSync().listDevices());
  ipcMain.handle('sync:revoke', (_e, deviceId: string) => requireSync().revokeDevice(deviceId));
  ipcMain.handle('sync:now', () => requireSync().syncNow());
  ipcMain.handle('sync:snapshot', () => requireSync().pushSnapshot());
  ipcMain.handle('sync:setEnabled', (_e, enabled: boolean) => requireSync().setEnabled(enabled));
  ipcMain.handle('sync:disconnect', () => requireSync().disconnect());

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
