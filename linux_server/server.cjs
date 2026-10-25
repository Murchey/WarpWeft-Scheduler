#!/usr/bin/env node
/**
 * Standalone Linux server entry. It reuses the same API, JSON store and Java
 * solver as the Electron desktop app; it never imports Electron.
 */
const fs = require('node:fs');
const path = require('node:path');
const { startApi } = require('../server/api/api.cjs');

const ROOT = path.resolve(__dirname, '..');

function readPort(value) {
  if (value === undefined || value === null || value === '') return 4317;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('WARPVEFT_PORT 必须是 0–65535 的整数，当前：' + value);
  }
  return port;
}

function readHost(value) {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  if (text === 'lan') return '0.0.0.0';
  if (text === 'loopback') return '127.0.0.1';
  return text;
}

function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'off', 'no'].includes(String(value).trim().toLowerCase());
}

function ensureWritableDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.accessSync(dir, fs.constants.W_OK);
}

/**
 * Start from environment variables. Exported so tests can use a temporary
 * directory and port 0 without spawning a second process.
 */
function startFromEnv(env = process.env, overrides = {}) {
  const rootDir = path.resolve(overrides.rootDir || ROOT);
  const dataDir = path.resolve(overrides.dataDir || env.WARPVEFT_DATA_DIR || path.join(rootDir, 'data'));
  const port = overrides.port ?? readPort(env.WARPVEFT_PORT);
  const host = overrides.host ?? readHost(env.WARPVEFT_HOST);
  const solverJar = path.resolve(
    overrides.solverJar || env.WARPVEFT_SOLVER_JAR || path.join(rootDir, 'resources', 'solver', 'warpweft-solver.jar'),
  );
  const trustProxy = overrides.trustProxy ?? readBoolean(env.WARPVEFT_TRUST_PROXY, true);
  const authEnabled = overrides.authEnabled ?? readBoolean(env.WARPVEFT_AUTH, true);
  ensureWritableDir(dataDir);
  if (!fs.existsSync(solverJar)) {
    console.warn('[warn] Java solver jar not found: ' + solverJar);
    console.warn('[warn] Run "npm run build:solver" before starting the service.');
  }

  const extra = {};
  for (const key of ['solverCommand', 'solverArgs', 'clientTtlMs', 'timeoutSecondsOverride', 'authSessionTtlMs']) {
    if (overrides[key] !== undefined) extra[key] = overrides[key];
  }
  const server = startApi({
    rootDir,
    dataDir,
    port,
    host,
    packaged: false,
    solverJar,
    configFile: path.join(dataDir, 'server-config.json'),
    trustProxy,
    authEnabled,
    ...extra,
  });
  return { server, rootDir, dataDir, port, host, solverJar, trustProxy, authEnabled };
}

function printReady(server, context) {
  const address = server.address();
  const actualPort = address && typeof address === 'object' ? address.port : context.port;
  const displayHost = context.host || '127.0.0.1';
  console.log('WarpWeft Linux server: http://' + displayHost + ':' + actualPort);
  console.log('Workspace data: ' + context.dataDir);
  console.log('Solver jar: ' + context.solverJar);
  console.log('Authentication: ' + (context.authEnabled ? 'enabled (Linux users)' : 'disabled'));
}

function main() {
  const context = startFromEnv(process.env);
  const { server } = context;
  let stopping = false;

  server.on('error', (error) => {
    console.error('Server error: ' + error.message);
    process.exitCode = 1;
  });
  server.on('listening', () => printReady(server, context));

  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log('Received ' + signal + ', shutting down…');
    const force = setTimeout(() => {
      try {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      } catch {
        // ignore
      }
      setTimeout(() => process.exit(1), 1000).unref();
    }, 10000);
    force.unref();
    server.close(() => {
      clearTimeout(force);
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception: ' + (error && error.stack ? error.stack : error));
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection: ' + (reason instanceof Error ? reason.stack : reason));
    process.exit(1);
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('Unable to start WarpWeft Linux server: ' + (error instanceof Error ? error.message : error));
    process.exit(1);
  }
}

module.exports = { startFromEnv, readPort, readHost };
