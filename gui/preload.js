const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFileDialog:  ()     => ipcRenderer.invoke('open-file-dialog'),
  runImgterm:      (opts) => ipcRenderer.invoke('run-imgterm', opts),
  runImgtermAll:   (opts) => ipcRenderer.invoke('run-imgterm-all', opts),
  exportAnsi:      (opts) => ipcRenderer.invoke('export-ansi', opts),
  deployMotd:      (opts) => ipcRenderer.invoke('deploy-motd', opts),

  testSsh:         (opts) => ipcRenderer.invoke('test-ssh', opts),
  writeTemp:       (b64)  => ipcRenderer.invoke('write-temp', b64),
  deleteTemp:      (p)    => ipcRenderer.invoke('delete-temp', p),

  onConsoleData:   (cb)   => ipcRenderer.on('console-data', (_e, data) => cb(data)),
  offConsoleData:  ()     => ipcRenderer.removeAllListeners('console-data'),
  consoleWrite:    (data) => ipcRenderer.send('console-write', data),
});
