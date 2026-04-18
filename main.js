const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const pty = require('node-pty');
const os = require('os');
const http = require('http');
const { Client } = require('ssh2');

let mainWindow;
let server;
const terminals = new Map();
let terminalIdCounter = 0;

const userDataPath = app.getPath('userData');
const dataFilePath = path.join(userDataPath, 'server_passwords.json');

// Simple static file server
function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);

      // Handle public directory
      if (req.url.startsWith('/public/')) {
        filePath = path.join(__dirname, req.url);
      }

      const extname = path.extname(filePath);
      const contentTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.ico': 'image/x-icon'
      };

      const contentType = contentTypes[extname] || 'application/octet-stream';

      fs.readFile(filePath, (err, content) => {
        if (err) {
          res.writeHead(404);
          res.end('Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content, 'utf-8');
        }
      });
    });

    server.listen(3847, () => {
      console.log('Server running at http://localhost:3847/');
      resolve();
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadURL('http://localhost:3847/');
}

app.whenReady().then(async () => {
  await startServer();
  createWindow();
});

// List Local Directory
ipcMain.handle('list-local-dir', async (event, { dirPath }) => {
  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    const result = files.map(file => ({
      name: file.name,
      isDir: file.isDirectory(),
      isFile: file.isFile(),
      path: path.join(dirPath, file.name)
    }));
    return { success: true, files: result, currentPath: dirPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Read Local File
ipcMain.handle('read-local-file', async (event, { filePath }) => {
  try {
    const data = fs.readFileSync(filePath);
    return { success: true, data: Array.from(data) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Delete Local File
ipcMain.handle('delete-local-file', async (event, { filePath }) => {
  try {
    fs.unlinkSync(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Delete Remote File via SFTP
ipcMain.handle('delete-remote-file', async (event, { server, remotePath }) => {
  return new Promise((resolve) => {
    const conn = new Client();
    const config = {
      host: server.ips[0],
      port: server.port || 22,
      username: server.username,
      password: server.password
    };

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          resolve({ success: false, error: err.message });
          return;
        }

        sftp.unlink(remotePath, (err) => {
          conn.end();
          if (err) {
            resolve({ success: false, error: err.message });
          } else {
            resolve({ success: true });
          }
        });
      });
    });

    conn.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    conn.connect(config);
  });
});

app.on('window-all-closed', () => {
  // Close all terminals
  terminals.forEach((term) => {
    try {
      term.kill();
    } catch (e) {}
  });
  terminals.clear();

  // Close server
  if (server) {
    server.close();
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

function loadData() {
  try {
    if (fs.existsSync(dataFilePath)) {
      const data = fs.readFileSync(dataFilePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error loading data:', e);
  }
  return { servers: [] };
}

function saveData(data) {
  try {
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('Error saving data:', e);
    return false;
  }
}

ipcMain.handle('load-data', () => {
  return loadData();
});

ipcMain.handle('save-data', (event, data) => {
  return saveData(data);
});

ipcMain.handle('get-user-path', () => {
  return os.homedir();
});

ipcMain.handle('export-file', async (event, { data, format }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出文件',
    defaultPath: `servers_export_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${format}`,
    filters: format === 'csv'
      ? [{ name: 'CSV', extensions: ['csv'] }]
      : [{ name: 'Excel', extensions: ['xlsx'] }]
  });

  if (!result.canceled && result.filePath) {
    try {
      const buffer = Buffer.from(data, 'base64');
      fs.writeFileSync(result.filePath, buffer);
      return { success: true, path: result.filePath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  return { success: false, canceled: true };
});

ipcMain.handle('import-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入文件',
    filters: [
      { name: 'All Supported', extensions: ['csv', 'xlsx', 'xls'] }
    ],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    try {
      const data = fs.readFileSync(result.filePaths[0]);
      return { success: true, data, path: result.filePaths[0] };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  return { success: false, canceled: true };
});

// Terminal IPC handlers
ipcMain.handle('terminal-create', (event, { id, shell, cwd }) => {
  const termId = id || `term-${++terminalIdCounter}`;
  const shellPath = shell || (os.platform() === 'win32' ? 'powershell.exe' : 'bash');

  try {
    const term = pty.spawn(shellPath, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd || os.homedir(),
      env: process.env
    });

    terminals.set(termId, term);

    term.onData((data) => {
      event.sender.send(`terminal-data-${termId}`, data);
    });

    term.onExit(() => {
      terminals.delete(termId);
      event.sender.send(`terminal-exit-${termId}`, '');
    });

    return { success: true, id: termId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('terminal-write', (event, { id, data }) => {
  const term = terminals.get(id);
  if (term) {
    term.write(data);
    return { success: true };
  }
  return { success: false, error: 'Terminal not found' };
});

ipcMain.handle('terminal-resize', (event, { id, cols, rows }) => {
  const term = terminals.get(id);
  if (term) {
    // node-pty has resize method, ssh2 stream does not
    if (typeof term.resize === 'function') {
      term.resize(cols, rows);
    } else if (term.setWindow) {
      // For SSH2 streams
      term.setWindow(rows, cols, 0, 0);
    }
    return { success: true };
  }
  return { success: false, error: 'Terminal not found' };
});

ipcMain.handle('terminal-destroy', (event, { id }) => {
  const term = terminals.get(id);
  if (term) {
    try {
      // node-pty uses kill(), ssh2 stream uses end()
      if (typeof term.kill === 'function') {
        term.kill();
      } else if (typeof term.end === 'function') {
        term.end();
      }
    } catch (e) {}
    terminals.delete(id);
    return { success: true };
  }
  return { success: false, error: 'Terminal not found' };
});

// SSH Connection using ssh2
ipcMain.handle('ssh-connect', async (event, { server }) => {
  const termId = `ssh-${server.id}-${Date.now()}`;

  return new Promise((resolve) => {
    const conn = new Client();
    const config = {
      host: server.ips[0],
      port: server.port || 22,
      username: server.username,
      password: server.password,
      // Handle keyboard-interactive auth (some servers use this instead of password auth)
      keyboardInteractive: (name, instructions, lang, prompts, finish) => {
        // If the prompt is for password, send the password
        if (prompts.length > 0 && prompts[0].prompt.toLowerCase().includes('password')) {
          finish([server.password]);
        } else {
          // For other prompts, send empty responses
          finish(prompts.map(() => ''));
        }
      }
    };

    conn.on('ready', () => {
      // Create interactive shell with PTY
      conn.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, stream) => {
        if (err) {
          conn.end();
          resolve({ success: false, error: err.message });
          return;
        }

        terminals.set(termId, stream);

        stream.on('data', (data) => {
          event.sender.send(`terminal-data-${termId}`, data.toString());
        });

        stream.on('close', () => {
          terminals.delete(termId);
          event.sender.send(`terminal-exit-${termId}`, '');
          conn.end();
        });

        resolve({ success: true, id: termId });
      });
    });

    conn.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    conn.connect(config);
  });
});

// List Remote Directory using ssh2
ipcMain.handle('list-remote-dir', async (event, { server, dirPath }) => {
  console.log('[DEBUG] list-remote-dir called with dirPath:', dirPath);
  return new Promise((resolve) => {
    const conn = new Client();
    const config = {
      host: server.ips[0],
      port: server.port || 22,
      username: server.username,
      password: server.password
    };

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          resolve({ success: false, error: err.message });
          return;
        }

        sftp.readdir(dirPath, (err, list) => {
          conn.end();
          if (err) {
            console.log('[DEBUG] readdir error:', err.message);
            resolve({ success: false, error: err.message });
            return;
          }

          console.log('[DEBUG] readdir success, item count:', list.length);
          const files = list.map(item => {
            const fullPath = dirPath.endsWith('/') ? dirPath + item.filename : dirPath + '/' + item.filename;
            console.log('[DEBUG] file:', item.filename, '-> path:', fullPath);
            return {
              name: item.filename,
              isDir: item.attrs.isDirectory(),
              size: item.attrs.size,
              path: fullPath
            };
          });

          resolve({ success: true, files, currentPath: dirPath });
        });
      });
    });

    conn.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    conn.connect(config);
  });
});

// File Upload via SFTP
ipcMain.handle('upload-file', async (event, { server, fileData, fileName, remotePath }) => {
  return new Promise((resolve) => {
    const conn = new Client();
    const config = {
      host: server.ips[0],
      port: server.port || 22,
      username: server.username,
      password: server.password
    };

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          resolve({ success: false, error: err.message });
          return;
        }

        const fullPath = remotePath.endsWith('/') ? remotePath + fileName : remotePath + '/' + fileName;
        const buffer = Buffer.from(fileData);

        sftp.writeFile(fullPath, buffer, (err) => {
          conn.end();
          if (err) {
            resolve({ success: false, error: err.message });
          } else {
            resolve({ success: true });
          }
        });
      });
    });

    conn.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    conn.connect(config);
  });
});

// File Download via SFTP
ipcMain.handle('download-file', async (event, { server, remotePath, localPath }) => {
  console.log('[DEBUG] download-file called:', { remotePath, localPath, serverIp: server.ips[0] });
  return new Promise((resolve) => {
    const conn = new Client();
    const config = {
      host: server.ips[0],
      port: server.port || 22,
      username: server.username,
      password: server.password
    };

    conn.on('ready', () => {
      console.log('[DEBUG] SSH connected, attempting SFTP readFile:', remotePath);
      conn.sftp((err, sftp) => {
        if (err) {
          console.log('[DEBUG] SFTP init error:', err.message);
          conn.end();
          resolve({ success: false, error: err.message });
          return;
        }

        // Use readFile + writeFile instead of non-existent fastGet
        sftp.readFile(remotePath, (err, data) => {
          if (err) {
            console.log('[DEBUG] readFile error:', err.message);
            conn.end();
            resolve({ success: false, error: err.message });
            return;
          }
          console.log('[DEBUG] readFile success, data length:', data ? data.length : 0);

          fs.writeFile(localPath, data, (writeErr) => {
            conn.end();
            if (writeErr) {
              console.log('[DEBUG] writeFile error:', writeErr.message);
              resolve({ success: false, error: writeErr.message });
            } else {
              console.log('[DEBUG] writeFile success');
              resolve({ success: true });
            }
          });
        });
      });
    });

    conn.on('error', (err) => {
      console.log('[DEBUG] SSH connection error:', err.message);
      resolve({ success: false, error: err.message });
    });

    conn.connect(config);
  });
});

// Read Remote File via SFTP
ipcMain.handle('read-remote-file', async (event, { server, remotePath }) => {
  return new Promise((resolve) => {
    const conn = new Client();
    const config = {
      host: server.ips[0],
      port: server.port || 22,
      username: server.username,
      password: server.password
    };

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          resolve({ success: false, error: err.message });
          return;
        }

        sftp.readFile(remotePath, 'utf8', (err, data) => {
          conn.end();
          if (err) {
            resolve({ success: false, error: err.message });
          } else {
            resolve({ success: true, data: data.substring(0, 10000) }); // Limit to 10KB
          }
        });
      });
    });

    conn.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    conn.connect(config);
  });
});
