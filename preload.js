const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('load-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  getUserPath: () => ipcRenderer.invoke('get-user-path'),
  exportFile: (options) => ipcRenderer.invoke('export-file', options),
  importFile: () => ipcRenderer.invoke('import-file'),

  // Terminal APIs
  terminal: {
    create: (options) => ipcRenderer.invoke('terminal-create', options),
    write: (id, data) => ipcRenderer.invoke('terminal-write', { id, data }),
    resize: (id, cols, rows) => ipcRenderer.invoke('terminal-resize', { id, cols, rows }),
    destroy: (id) => ipcRenderer.invoke('terminal-destroy', { id }),
    onData: (id, callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on(`terminal-data-${id}`, listener);
      return () => ipcRenderer.removeListener(`terminal-data-${id}`, listener);
    },
    onExit: (id, callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on(`terminal-exit-${id}`, listener);
      return () => ipcRenderer.removeListener(`terminal-exit-${id}`, listener);
    }
  },

  // SSH
  sshConnect: (server) => ipcRenderer.invoke('ssh-connect', { server }),

  // File Transfer
  uploadFile: (options) => ipcRenderer.invoke('upload-file', options),
  downloadFile: (options) => ipcRenderer.invoke('download-file', options),
  listRemoteDir: (options) => ipcRenderer.invoke('list-remote-dir', options),
  listLocalDir: (options) => ipcRenderer.invoke('list-local-dir', options),
  readLocalFile: (options) => ipcRenderer.invoke('read-local-file', options),
  readRemoteFile: (options) => ipcRenderer.invoke('read-remote-file', options),
  deleteLocalFile: (options) => ipcRenderer.invoke('delete-local-file', options),
  deleteRemoteFile: (options) => ipcRenderer.invoke('delete-remote-file', options)
});
