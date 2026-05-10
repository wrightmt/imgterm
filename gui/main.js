const { app, BrowserWindow, ipcMain, dialog, Menu, screen } = require('electron');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');
const { Client: SSHClient } = require('ssh2');

// Holds the active SSH exec channel so the renderer can write to its stdin
let activeChannel = null;

// Single-quote–safe shell escaping for user-supplied paths
function sq(s) { return "'" + s.replace(/'/g, "'\\''") + "'"; }

ipcMain.on('console-write', (_e, data) => {
  if (activeChannel) activeChannel.write(data);
});

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const winW = Math.min(sw, 1400);
  const winH = Math.min(sh, 920);
  const win = new BrowserWindow({
    width: winW,
    height: winH,
    minWidth: 900,
    minHeight: 700,
    backgroundColor: '#080a0b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'imgterm — MOTD Deployer',
  });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: 'File',
    submenu: [
      { role: 'reload' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  }]));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('open-file-dialog', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    title: 'Select Image',
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 'webp'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  return filePaths[0] ?? null;
});

const fs = require('fs');

const ALL_MODES = [
  'normal','green','amber','grunge','green-grunge','amber-grunge',
  'ascii','ascii-green','ascii-amber','16color',
  'rainbow','thermal','neon','glitch','custom',
];

function imgTermBin() {
  const name = process.platform === 'win32' ? 'imgterm.exe' : 'imgterm';
  if (app.isPackaged) return path.join(process.resourcesPath, name);
  return path.join(__dirname, '..', 'target', 'release', name);
}

function spawnImgterm(imagePath, mode, width, rows, customColor) {
  return new Promise((resolve, reject) => {
    const bin = imgTermBin();
    const args = [];
    if (width) args.push('-w', String(width));
    if (rows)  args.push('-r', String(rows));
    if (mode && mode !== 'normal') args.push('-m', mode);
    if (mode === 'custom' && customColor) args.push('-c', customColor.replace('#', ''));
    args.push(imagePath);

    const proc = spawn(bin, args);
    const out = [], err = [];
    proc.stdout.on('data', d => out.push(d));
    proc.stderr.on('data', d => err.push(d));
    proc.on('error', e => reject(new Error(
      e.code === 'ENOENT'
        ? 'imgterm.exe not found — run: cargo build --release'
        : `Failed to start imgterm: ${e.message}`
    )));
    proc.on('close', code => {
      if (code !== 0) reject(new Error(Buffer.concat(err).toString().trim() || `imgterm exited ${code}`));
      else resolve(Buffer.concat(out).toString('utf8'));
    });
  });
}

ipcMain.handle('run-imgterm', async (_event, { imagePath, mode, width, rows, customColor }) => {
  return spawnImgterm(imagePath, mode, width, rows, customColor);
});

// Render all modes at small dimensions in parallel for the style grid
ipcMain.handle('run-imgterm-all', async (_event, { imagePath, width, rows, customColor }) => {
  const results = await Promise.allSettled(
    ALL_MODES.map(mode => spawnImgterm(imagePath, mode, width, rows, mode === 'custom' ? customColor : null))
  );
  return ALL_MODES.map((mode, i) => ({
    mode,
    ansi:  results[i].status === 'fulfilled' ? results[i].value       : null,
    error: results[i].status === 'rejected'  ? results[i].reason.message : null,
  }));
});

// Save ANSI content to a user-chosen file
ipcMain.handle('export-ansi', async (_event, { content, defaultName }) => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Export ANSI Art',
    defaultPath: defaultName || 'motd.ans',
    filters: [
      { name: 'ANSI Art', extensions: ['ans'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, Buffer.from(content, 'utf8'));
  return filePath;
});

ipcMain.handle('test-ssh', async (event, { host, port, username, password, remotePath }) => {
  const log = (text, type = 'out') => event.sender.send('console-data', { text, type });
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    conn.on('ready', () => {
      log(`Connected to ${username}@${host}\n`, 'ok');
      // Cat the configured data file directly — avoids profile.d PTY behaviour
      const filePath = remotePath || '/etc/motd.imgterm';
      log(`Reading ${filePath}…\n`, 'sys');
      const cmd = `cat ${sq(filePath)}`;
      conn.exec(cmd, (err, channel) => {
        if (err) { conn.end(); return reject(err); }
        const out = [];
        channel.on('data', d => out.push(d));
        channel.stderr.on('data', d => log(d.toString(), 'err'));
        channel.on('close', code => {
          conn.end();
          if (code !== 0) {
            const msg = `File not found: ${filePath}`;
            log(msg + '\n', 'err');
            return reject(new Error(msg));
          }
          const ansi = Buffer.concat(out).toString('utf8');
          log(`Received ${ansi.length.toLocaleString()} bytes.\n`, 'sys');
          resolve(ansi);
        });
      });
    });
    conn.on('error', err => reject(err));
    conn.connect({ host, port: Number(port) || 22, username, password, readyTimeout: 8000 });
  });
});

// Write a base64-encoded PNG to a temp file for adjusted-image rendering
ipcMain.handle('write-temp', async (_event, base64) => {
  const tmp = path.join(os.tmpdir(), `.imgterm_adj_${Date.now()}.png`);
  fs.writeFileSync(tmp, Buffer.from(base64, 'base64'));
  return tmp;
});

ipcMain.handle('delete-temp', async (_event, tmpPath) => {
  try { fs.unlinkSync(tmpPath); } catch {}
});

ipcMain.handle('deploy-motd', async (event, { host, port, username, password, remotePath, content, useSudo, sudoPassword, deployMode }) => {
  const log = (text, type = 'out') => event.sender.send('console-data', { text, type });

  return new Promise((resolve, reject) => {
    const conn = new SSHClient();

    conn.on('ready', () => {
      log(`Connected to ${username}@${host}\n`, 'ok');

      conn.sftp((sftpErr, sftp) => {
        if (sftpErr) {
          log(`SFTP error: ${sftpErr.message}\n`, 'err');
          conn.end(); return reject(sftpErr);
        }

        const tmp = `/tmp/.imgterm_${Date.now()}`;
        const bytes = Buffer.byteLength(content, 'utf8');
        log(`Uploading ${bytes.toLocaleString()} bytes → ${tmp}\n`, 'sys');

        const ws = sftp.createWriteStream(tmp);

        ws.on('close', () => {
          log(`Upload complete.\n`, 'sys');

          const spwd = (sudoPassword || password).replace(/'/g, `'\\''`);
          let cmd, displayCmd;

          if (deployMode === 'ubuntu-profile' || deployMode === 'ubuntu-motd') {
            // profile.d: script is sourced by bash after PTY is up — ANSI works.
            // update-motd: script runs via PAM conversation — ANSI typically stripped.
            const scriptPath = deployMode === 'ubuntu-profile'
              ? '/etc/profile.d/imgterm-motd.sh'
              : '/etc/update-motd.d/00-imgterm';
            // profile.d scripts are sourced (not exec'd), so guard against non-interactive calls.
            const scriptBody = deployMode === 'ubuntu-profile'
              ? `#!/bin/sh\n[ -f ${sq(remotePath)} ] && cat ${sq(remotePath)}\n`
              : `#!/bin/sh\ncat ${sq(remotePath)}\n`;
            const inner = [
              `cp ${tmp} ${sq(remotePath)}`,
              `rm -f ${tmp}`,
              `printf '%s' ${sq(scriptBody)} > ${sq(scriptPath)}`,
              `chmod 755 ${sq(scriptPath)}`,
            ].join(' && ');
            cmd = useSudo
              ? `echo '${spwd}' | sudo -S -p '[sudo] password: ' sh -c "${inner.replace(/"/g, '\\"')}"`
              : inner;
            displayCmd = `cp ${tmp} → ${remotePath}  +  create ${scriptPath}`;
            log(`$ ${displayCmd}\n`, 'sys');
            log(`  ${scriptPath}: ${scriptBody.replace(/\\n/g, ' ')}\n`, 'sys');
          } else {
            cmd = useSudo
              ? `echo '${spwd}' | sudo -S -p '[sudo] password: ' cp ${tmp} ${sq(remotePath)} && rm -f ${tmp}`
              : `cp ${tmp} ${sq(remotePath)} && rm -f ${tmp}`;
            displayCmd = useSudo ? `sudo cp ${tmp} ${remotePath}` : `cp ${tmp} ${remotePath}`;
            log(`$ ${displayCmd}\n`, 'sys');
          }

          conn.exec(cmd, (execErr, channel) => {
            if (execErr) {
              log(`Exec error: ${execErr.message}\n`, 'err');
              conn.end(); return reject(execErr);
            }

            activeChannel = channel;

            channel.on('data',        d => log(d.toString(), 'out'));
            channel.stderr.on('data', d => log(d.toString(), 'err'));

            channel.on('close', code => {
              activeChannel = null;
              conn.end();
              if (code === 0) {
                log(`\nDeployed successfully to ${remotePath}\n`, 'ok');
                resolve('OK');
              } else {
                const msg = `Command exited with code ${code}`;
                log(`\n${msg}\n`, 'err');
                reject(new Error(msg));
              }
            });
          });
        });

        ws.on('error', e => {
          log(`Upload error: ${e.message}\n`, 'err');
          conn.end(); reject(e);
        });
        ws.end(Buffer.from(content, 'utf8'));
      });
    });

    conn.on('error', err => {
      log(`Connection failed: ${err.message}\n`, 'err');
      reject(err);
    });

    log(`Connecting to ${username}@${host}:${Number(port) || 22}...\n`, 'sys');
    conn.connect({ host, port: Number(port) || 22, username, password, readyTimeout: 10000 });
  });
});
