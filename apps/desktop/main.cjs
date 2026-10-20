const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { openDatabase } = require('./database.cjs');

const rootDir = path.resolve(__dirname, '../..');
let server;

function startApi() {
  const db = openDatabase(rootDir);
  server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method === 'POST' && req.url === '/api/solve') {
      let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => {
        const solver = spawn(process.platform === 'win32' ? 'python' : 'python3', [path.join(rootDir, 'services/solver/solver.py')]);
        let output = ''; solver.stdout.on('data', chunk => output += chunk); solver.on('close', code => { res.statusCode = code === 0 ? 200 : 500; res.end(output || JSON.stringify({ status: 'FAILED' })); });
        solver.stdin.end(body);
      }); return;
    }
    if (req.method === 'GET' && req.url === '/api/health') { res.end(JSON.stringify({ ok: true, database: 'sqlite' })); return; }
    res.statusCode = 404; res.end(JSON.stringify({ error: 'Not found' }));
  });
  server.listen(4317, '127.0.0.1');
}

function createWindow() {
  const window = new BrowserWindow({ width: 1440, height: 920, minWidth: 980, minHeight: 700, webPreferences: { contextIsolation: true, sandbox: true } });
  if (process.env.VITE_DEV_SERVER_URL) window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else window.loadFile(path.join(rootDir, 'dist', 'index.html'));
}

app.whenReady().then(() => { startApi(); createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (server) server.close(); if (process.platform !== 'darwin') app.quit(); });
