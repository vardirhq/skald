import { contextBridge, ipcRenderer, webUtils } from 'electron';

// Thin, typed-on-the-renderer-side bridge. Every call is invoke-based; the
// only push channels are vault:changed (snapshots) and window:maximized.

const api = {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  onVaultChanged: (cb: (snapshot: unknown) => void) => {
    const handler = (_e: unknown, snapshot: unknown) => cb(snapshot);
    ipcRenderer.on('vault:changed', handler);
    return () => ipcRenderer.removeListener('vault:changed', handler);
  },
  onSyncChanged: (cb: (status: unknown) => void) => {
    const handler = (_e: unknown, status: unknown) => cb(status);
    ipcRenderer.on('sync:changed', handler);
    return () => ipcRenderer.removeListener('sync:changed', handler);
  },
  onWindowMaximized: (cb: (maximized: boolean) => void) => {
    const handler = (_e: unknown, maximized: boolean) => cb(maximized);
    ipcRenderer.on('window:maximized', handler);
    return () => ipcRenderer.removeListener('window:maximized', handler);
  },
};

contextBridge.exposeInMainWorld('skald', api);

export type SkaldBridge = typeof api;
