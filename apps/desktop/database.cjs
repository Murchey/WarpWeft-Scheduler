const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDatabase(rootDir) {
  const dataDir = path.join(rootDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'warpweft.sqlite'));
  db.exec(fs.readFileSync(path.join(rootDir, 'database', 'schema.sql'), 'utf8'));
  return db;
}

module.exports = { openDatabase };
