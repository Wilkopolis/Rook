import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a']);

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

const thumbCacheDir = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'Rook',
  'Thumbnails'
);

// Dev-server-only stand-in for the desktop host's logger (see desktop-host/RookLog.cs).
const devLogDir = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'Rook',
  'logs'
);
const devLogFile = path.join(devLogDir, 'rook-dev.log');
let devLoggingEnabled = false;

function computeThumbKey(fullPath: string, mtimeMs: number, sizeBytes: number, thumbSize: number): string {
  const raw = `${fullPath.toLowerCase()}|${Math.floor(mtimeMs)}|${sizeBytes}|${thumbSize}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

function localFsBridgePlugin(): Plugin {
  return {
    name: 'local-fs-bridge',
    configureServer(server) {
      fsSync.mkdirSync(thumbCacheDir, { recursive: true });

      server.middlewares.use('/api/fs', async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://localhost');
          const action = url.pathname.replace(/^\//, '');

          // GET /api/fs/thumb?path=...&size=128
          if (req.method === 'GET' && action === 'thumb') {
            const rawPath = url.searchParams.get('path') || '';
            const size = Math.min(512, Math.max(32, Number(url.searchParams.get('size') || 128)));
            if (!rawPath || !fsSync.existsSync(rawPath)) {
              res.statusCode = 404;
              res.end();
              return;
            }
            const stat = await fs.stat(rawPath);
            const ext = path.extname(rawPath).replace(/^\./, '').toLowerCase();

            if (ext === 'svg') {
              res.setHeader('Content-Type', 'image/svg+xml');
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
              fsSync.createReadStream(rawPath).pipe(res);
              return;
            }

            const key = computeThumbKey(rawPath, stat.mtimeMs, stat.size, size);
            const cachedPng = path.join(thumbCacheDir, `${key}.png`);

            if (fsSync.existsSync(cachedPng)) {
              res.setHeader('Content-Type', 'image/png');
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
              fsSync.createReadStream(cachedPng).pipe(res);
              return;
            }

            // Copy/cache image to thumbCacheDir if under 10MB
            if (IMAGE_EXTS.has(ext) && stat.size < 10 * 1024 * 1024) {
              if (ext === 'png') {
                await fs.copyFile(rawPath, cachedPng);
              }
              res.setHeader('Content-Type', MIME_MAP[ext] || 'application/octet-stream');
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
              fsSync.createReadStream(rawPath).pipe(res);
              return;
            }

            res.statusCode = 404;
            res.end();
            return;
          }

          // GET /api/fs/raw?path=...
          if (req.method === 'GET' && action === 'raw') {
            const rawPath = url.searchParams.get('path') || '';
            if (!rawPath || !fsSync.existsSync(rawPath)) {
              res.statusCode = 404;
              res.end();
              return;
            }
            const ext = path.extname(rawPath).replace(/^\./, '').toLowerCase();
            res.setHeader('Content-Type', MIME_MAP[ext] || 'application/octet-stream');
            fsSync.createReadStream(rawPath).pipe(res);
            return;
          }

          res.setHeader('Content-Type', 'application/json');
          let body: Record<string, any> = {};
          if (req.method === 'POST') {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(Buffer.from(chunk));
            body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
          }

          if (['winDrag', 'winResize', 'winMinimize', 'winMaximize', 'winClose'].includes(action)) {
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (action === 'logSettings') {
            if (typeof body.enabled === 'boolean') devLoggingEnabled = body.enabled;
            res.end(JSON.stringify({ enabled: devLoggingEnabled, logDir: devLogDir, logFile: devLogFile }));
            return;
          }

          if (action === 'log') {
            const entries: any[] = Array.isArray(body.entries) ? body.entries.slice(0, 500) : [];
            const lines = entries
              .filter((e) => devLoggingEnabled || e?.level === 'error' || e?.level === 'fatal')
              .map((e) => {
                const ts = new Date(typeof e.ts === 'number' ? e.ts : Date.now()).toISOString();
                const data = e.data === undefined ? '' : `\n    ${JSON.stringify(e.data)}`;
                return `${ts} ${String(e.level || 'info').toUpperCase().padEnd(5)} [ui/${e.category || 'app'}] ${e.message || ''}${data}\n`;
              });
            if (lines.length) {
              await fs.mkdir(devLogDir, { recursive: true });
              await fs.appendFile(devLogFile, lines.join(''));
            }
            res.end(JSON.stringify({ ok: true, written: lines.length }));
            return;
          }

          if (action === 'openLogFolder') {
            await fs.mkdir(devLogDir, { recursive: true });
            execFile('explorer.exe', [devLogDir], { windowsHide: false }).unref();
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (action === 'info') {
            const cwd = process.cwd();
            const home = os.homedir();
            const drives: string[] = [];
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

          if (action === 'thumbStats' || action === 'setThumbMaxSize') {
            const maxCacheMb = typeof body.maxCacheMb === 'number'
              ? Math.max(16, Math.min(10240, Math.round(body.maxCacheMb)))
              : 250;
            const files = fsSync.existsSync(thumbCacheDir)
              ? (await fs.readdir(thumbCacheDir)).filter((f) => f.endsWith('.png'))
              : [];
            let totalBytes = 0;
            for (const f of files) {
              try {
                const st = await fs.stat(path.join(thumbCacheDir, f));
                totalBytes += st.size;
              } catch {}
            }
            res.end(JSON.stringify({ count: files.length, totalBytes, maxCacheMb, cacheDir: thumbCacheDir }));
            return;
          }

          if (action === 'clearThumbs') {
            if (fsSync.existsSync(thumbCacheDir)) {
              const files = await fs.readdir(thumbCacheDir);
              await Promise.all(
                files
                  .filter((f) => f.endsWith('.png'))
                  .map((f) => fs.unlink(path.join(thumbCacheDir, f)).catch(() => {}))
              );
            }
            res.end(JSON.stringify({ ok: true, count: 0, totalBytes: 0, maxCacheMb: 250, cacheDir: thumbCacheDir }));
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
                let createdMs = modifiedMs;
                let isDirectory = d.isDirectory();
                try {
                  const stat = await fs.stat(fullPath);
                  sizeBytes = stat.size;
                  modifiedMs = stat.mtimeMs;
                  createdMs = stat.birthtimeMs;
                  isDirectory = stat.isDirectory();
                } catch {}
                const ext = isDirectory ? 'folder' : path.extname(d.name).replace(/^\./, '').toLowerCase();
                return {
                  name: d.name,
                  path: fullPath,
                  isDirectory,
                  sizeBytes,
                  modifiedMs,
                  createdMs,
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
            const ext = path.extname(targetPath).replace(/^\./, '').toLowerCase();
            if (IMAGE_EXTS.has(ext)) {
              res.end(
                JSON.stringify({
                  kind: 'image',
                  url: `/api/fs/raw?path=${encodeURIComponent(targetPath)}&m=${Math.floor(stat.mtimeMs)}`,
                  thumbUrl: `/api/fs/thumb?path=${encodeURIComponent(targetPath)}&size=256&m=${Math.floor(stat.mtimeMs)}`,
                })
              );
              return;
            }
            if (VIDEO_EXTS.has(ext)) {
              res.end(
                JSON.stringify({
                  kind: 'video',
                  url: `/api/fs/raw?path=${encodeURIComponent(targetPath)}&m=${Math.floor(stat.mtimeMs)}`,
                })
              );
              return;
            }
            if (AUDIO_EXTS.has(ext)) {
              res.end(
                JSON.stringify({
                  kind: 'audio',
                  url: `/api/fs/raw?path=${encodeURIComponent(targetPath)}&m=${Math.floor(stat.mtimeMs)}`,
                })
              );
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
            const base = path.basename(body.sourcePath);
            let destPath = path.join(body.destDir, base);
            if (path.resolve(body.sourcePath).toLowerCase() === path.resolve(destPath).toLowerCase()) {
              const ext = path.extname(base);
              const stem = path.basename(base, ext);
              destPath = path.join(body.destDir, `${stem} - Copy${ext}`);
              let idx = 2;
              while (fsSync.existsSync(destPath)) {
                destPath = path.join(body.destDir, `${stem} - Copy (${idx})${ext}`);
                idx++;
              }
            }
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

          if (action === 'openPowershell') {
            const targetDir = path.resolve(body.path || process.cwd());
            const child = execFile(
              'cmd.exe',
              [
                '/c',
                'start',
                'powershell.exe',
                '-NoExit',
                '-Command',
                `Set-Location -LiteralPath '${targetDir.replace(/'/g, "''")}'`,
              ],
              { cwd: targetDir, windowsHide: false }
            );
            child.unref();
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (action === 'openFile') {
            const targetPath = path.resolve(body.path);
            const child = execFile('cmd.exe', ['/c', 'start', '""', targetPath], { windowsHide: true });
            child.unref();
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (action === 'revealInExplorer') {
            const targetPath = path.resolve(body.path);
            const child = execFile('explorer.exe', [`/select,${targetPath}`], { windowsHide: false });
            child.unref();
            res.end(JSON.stringify({ ok: true }));
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
              const statuses: Record<string, string> = {};
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
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err?.message || String(err) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localFsBridgePlugin()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/desktop-host/**', '**/src-tauri/**', '**/release/**'],
    },
  },
});
