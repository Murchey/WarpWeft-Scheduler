const fs = require('node:fs');
const path = require('node:path');
function clone(value) {
  return structuredClone(value);
}

function emptyWorkspace() {
  return {
    school: { id: 'school-local', name: '未设置学校' },
    classes: [], teachers: [], subjects: [], rooms: [], timeSlots: [], coursePlans: [],
    unavailableSlots: [], rules: [], softConstraints: [
      { kind: 'SUBJECT_DISTRIBUTION', weight: 3 },
      { kind: 'TEACHER_CONTINUOUS', weight: 2 },
      { kind: 'TEACHER_GAPS', weight: 1 },
      { kind: 'TEACHER_WORKLOAD_BALANCE', weight: 2 },
      { kind: 'CLASS_GAPS', weight: 2 },
    ], candidate: null, published: null, auditLog: [],
  };
}

function isDemoWorkspace(value) {
  return value?.school?.id === 'school-demo' || value?.school?.name === '演示中学';
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
  if (!data || !Array.isArray(data.classes) || !Array.isArray(data.coursePlans) || isDemoWorkspace(data)) {
    data = emptyWorkspace();
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
