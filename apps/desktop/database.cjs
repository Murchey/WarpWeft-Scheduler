const fs = require('node:fs');
const path = require('node:path');
const seed = require('../../database/seeds/demo.json');

function clone(value) {
  return structuredClone(value);
}

function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * Small single-machine store. Electron 33 ships Node 20, where node:sqlite is
 * not available, so this MVP keeps the dataset in one JSON file. The public
 * shape matches the future SQLite adapter: read(), write(), file.
 */
function openDatabase(rootDir, dataDir = path.join(rootDir, 'data')) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'warpweft.json');
  let data = null;
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      data = null;
    }
  }
  if (!data || !Array.isArray(data.classes) || !Array.isArray(data.coursePlans)) {
    data = clone(seed);
    writeJson(file, data);
  }
  return {
    file,
    read: () => clone(data),
    write: (next) => {
      const normalized = { ...next, updatedAt: new Date().toISOString() };
      writeJson(file, normalized);
      data = normalized;
      return clone(data);
    },
  };
}

module.exports = { openDatabase };
