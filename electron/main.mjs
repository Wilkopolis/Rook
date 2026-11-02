import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function handleFsApi(req, res, action) {
  res.setHeader('Content-Type', 'application/json');
  try {
    let body = {};
    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
    }

    if (action === 'info') {
      const cwd = process.cwd();
      const home = os.homedir();
      const drives = [];
      if (process.platform === 'win32') {
        for (const letter of ['C', 'D', 'E', 'F', 'G']) {
          const drivePath = `${letter}:\\`;
          if (fsSync.existsSync(drivePath)) drives.push(drivePath);
        }
      } else {
        drives.push('/');
      }
      res.end(JSON.stringify({ cwd, home, drives, platform: process.platform }));
      return;
    }

    if (action === 'list') {
      const targetPath = path.resolve(body.path || process.cwd());
      const dirents = await fs.readdir(targetPath, { withFileTypes: true });
      const items = await Promise.all(
        dirents.slice(0, 500).map(async (d) => {
          const fullPath = path.join(targetPath, d.name);
          let sizeBytes = 0;
          let modifiedMs = Date.now();
          let isDirectory = d.isDirectory();
          try {
            const stat = await fs.stat(fullPath);
            sizeBytes = stat.size;
            modifiedMs = stat.mtimeMs;
            isDirectory = stat.isDirectory();
          } catch {
            // Ignore locked system files
          }
          const ext = isDirectory ? 'folder' : path.extname(d.name).replace(/^\./, '').toLowerCase();
          return {
            name: d.name,
            path: fullPath,
            isDirectory,
            sizeBytes,
            modifiedMs,
            extension: ext,
          };
        })
      );
      const parentPath = path.dirname(targetPath) !== targetPath ? path.dirname(targetPath) : null;
      res.end(JSON.stringify({ path: targetPath, parentPath, items }));
      return;
    }

    if (action === 'preview') {
      const targetPath = path.resolve(body.path);
      const stat = await fs.stat(targetPath);
      if (stat.isDirectory()) {
        const children = await fs.readdir(targetPath);
        res.end(JSON.stringify({ kind: 'directory', children: children.slice(0, 40) }));
        return;
      }
      if (stat.size > 256 * 1024) {
        res.end(
          JSON.stringify({
            kind: 'binary',
            message: `Large file (${(stat.size / 1024).toFixed(1)} KB) — preview truncated`,
          })
        );
        return;
      }
      const buf = await fs.readFile(targetPath);
      const isBinary = buf.subarray(0, 512).includes(0);
      if (isBinary) {
        res.end(JSON.stringify({ kind: 'binary', message: `Binary file (${stat.size} bytes)` }));
      } else {
        res.end(JSON.stringify({ kind: 'text', content: buf.toString('utf-8').slice(0, 8000) }));
      }
      return;
    }

    if (action === 'mkdir') {
      const targetPath = path.join(body.dir, body.name);
      await fs.mkdir(targetPath, { recursive: true });
      res.end(JSON.stringify({ ok: true, path: targetPath }));
      return;
    }

    if (action === 'createFile') {
      const targetPath = path.join(body.dir, body.name);
      await fs.writeFile(targetPath, body.content || '', { flag: 'wx' });
      res.end(JSON.stringify({ ok: true, path: targetPath }));
      return;
    }

    if (action === 'rename') {
      const newPath = path.join(path.dirname(body.oldPath), body.newName);
      await fs.rename(body.oldPath, newPath);
      res.end(JSON.stringify({ ok: true, path: newPath }));
      return;
    }

    if (action === 'delete') {
      await fs.rm(body.path, { recursive: true, force: true });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (action === 'copy') {
      const destPath = path.join(body.destDir, path.basename(body.sourcePath));
      await fs.cp(body.sourcePath, destPath, { recursive: true });
      res.end(JSON.stringify({ ok: true, path: destPath }));
      return;
    }

    if (action === 'move') {
      const destPath = path.join(body.destDir, path.basename(body.sourcePath));
      await fs.rename(body.sourcePath, destPath);
      res.end(JSON.stringify({ ok: true, path: destPath }));
      return;
    }

    if (action === 'gitStatus') {
      try {
        const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: body.path,
        });
        const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
          cwd: body.path,
        });
        const statuses = {};
        for (const line of statusOut.split('\n')) {
          if (!line.trim()) continue;
          const code = line.slice(0, 2).trim();
          const file = line.slice(3).trim();
          statuses[file] = code;
        }
        res.end(JSON.stringify({ branch: branchOut.trim(), statuses }));
      } catch {
        res.end(JSON.stringify({ branch: null, statuses: {} }));
      }
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Unknown action' }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err?.message || String(err) }));
  }
}

function startEmbeddedServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/fs/')) {
        const action = url.pathname.replace('/api/fs/', '');
        await handleFsApi(req, res, action);
        return;
      }

      let filePath = path.join(distDir, url.pathname === '/' ? 'index.html' : url.pathname);
      if (!fsSync.existsSync(filePath)) {
        filePath = path.join(distDir, 'index.html');
      }
      try {
        const ext = path.extname(filePath).toLowerCase();
        res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
        const content = await fs.readFile(filePath);
        res.end(content);
      } catch {
        res.statusCode = 404;
        res.end('Not found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(addr.port);
    });
  });
}

let mainWindow = null;

app.whenReady().then(async () => {
  const port = await startEmbeddedServer();
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Crush Explorer',
    backgroundColor: '#0b0f19',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
});

app.on('window-all-closed', () => {
  app.quit();
});
