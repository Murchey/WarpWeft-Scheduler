#!/usr/bin/env node
/**
 * Verify that the installed Linux package still matches the server that is
 * running. The build manifest records the exact API/schema/renderer/solver
 * hashes; this catches a half-applied upgrade where the UI or server API is
 * newer than the data schema (or vice versa).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fail(message) {
  console.error('[fail] ' + message);
  process.exitCode = 1;
}

const healthFile = process.argv[2];
const appDir = path.resolve(process.argv[3] || path.join(__dirname, '..'));
if (!healthFile) {
  console.error('用法: node verify-manifest.cjs <health.json> [appDir]');
  process.exit(2);
}
const manifestFile = path.join(appDir, 'warpweft-build.json');
if (!fs.existsSync(manifestFile)) fail('缺少构建清单：' + manifestFile);
else {
  try {
    const health = readJson(healthFile);
    const manifest = readJson(manifestFile);
    const schema = readJson(path.join(appDir, 'data-schema.json'));

    const expected = {
      appVersion: manifest.appVersion,
      schemaVersion: manifest.schemaVersion,
      solverProtocol: manifest.solverProtocol,
      capabilities: manifest.capabilities,
    };
    const actual = {
      appVersion: health.appVersion,
      schemaVersion: health.schemaVersion,
      solverProtocol: health.solverProtocol,
      capabilities: health.capabilities,
    };
    for (const key of ['appVersion', 'schemaVersion', 'solverProtocol']) {
      if (actual[key] !== expected[key]) fail(key + ' 不一致：服务端 ' + actual[key] + '，安装包 ' + expected[key]);
    }
    if (JSON.stringify(actual.capabilities) !== JSON.stringify(expected.capabilities)) {
      fail('capabilities 不一致：服务端 ' + JSON.stringify(actual.capabilities) + '，安装包 ' + JSON.stringify(expected.capabilities));
    }
    if (Number(schema.version) !== Number(manifest.schemaVersion)) {
      fail('data-schema.json v' + schema.version + ' 与构建清单 v' + manifest.schemaVersion + ' 不一致');
    }

    const files = {
      rendererIndex: path.join(appDir, 'dist', 'index.html'),
      siteIndex: path.join(appDir, 'dist', 'site', 'index.html'),
      serverApi: path.join(appDir, 'server', 'api', 'api.cjs'),
      serverEntry: path.join(appDir, 'linux_server', 'server.cjs'),
      dataSchema: path.join(appDir, 'data-schema.json'),
      solverJar: path.join(appDir, 'resources', 'solver', 'warpweft-solver.jar'),
    };
    for (const [key, file] of Object.entries(files)) {
      const expectedHash = manifest.hashes && manifest.hashes[key];
      // 构建清单里没有登记哈希的条目不参与校验：不带官网的旧安装包不会被新脚本判失败
      if (!expectedHash) continue;
      if (!fs.existsSync(file)) {
        fail('缺少文件：' + file);
        continue;
      }
      if (sha256(file) !== expectedHash) {
        fail(key + ' 哈希不一致，安装包可能被部分覆盖或未重新构建');
      }
    }
    for (const [ref, expectedHash] of Object.entries(manifest.assetHashes || {})) {
      const clean = ref.split('?')[0].split('#')[0].replace(/^\/+/, '');
      const file = path.resolve(appDir, 'dist', clean);
      if (!file.startsWith(path.resolve(appDir, 'dist') + path.sep)) {
        fail('renderer 资源路径越界：' + ref);
        continue;
      }
      if (!fs.existsSync(file)) {
        fail('缺少 renderer 资源：' + ref);
        continue;
      }
      if (sha256(file) !== expectedHash) fail('renderer 资源哈希不一致：' + ref);
    }
    if (!process.exitCode) console.log('[ok] build manifest matches health, schema and package hashes');
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
