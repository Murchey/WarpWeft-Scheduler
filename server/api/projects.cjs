/**
 * 多工程（项目）存储。
 *
 * 设计要点：`data/warpweft.json` 始终是"当前正在编辑的工作区"，`store.read()/write()`
 * 的语义完全不变；**切换工程 = 把工程快照写进 warpweft.json**。因此排课、防抖保存、
 * validateData、dataSchemaVersion 注入等既有链路零改动。
 *
 * 目录布局：
 *   <dataDir>/projects/index.json          工程清单 + 活动指针（单一真源，避免双文件漂移）
 *   <dataDir>/projects/p_<id>.zip          工程包：分片 JSON 的 ZIP（见 projectSnapshot.cjs）
 *   <dataDir>/projects/_autosave/<id>-<ts>.zip    切换前的自动备份，每工程保留最近 3 份
 *
 * 该模块被 Windows(Electron) 与 Linux(server.cjs) 共用，因为两端都 require 同一份
 * server/api/api.cjs 并调用同一个 startApi()。
 */
const fs = require('node:fs');
const path = require('node:path');
const { writeJson } = require('./database.cjs');
const { encodeSnapshot, decodeSnapshot, SNAPSHOT_EXT } = require('./projectSnapshot.cjs');

const WORKSPACE_FORMAT = 'warpweft-workspace';
/** 导入时接受 v1（旧的单文件 .workspace.json）到当前版本。 */
const WORKSPACE_VERSION = 2;

const INDEX_VERSION = 1;
const INDEX_FILE = 'index.json';
const PROJECTS_SUBDIR = 'projects';
const AUTOSAVE_SUBDIR = '_autosave';

const MAX_PROJECTS = 30;
/** 相对 api.cjs 的 MAX_BODY(5 MiB) 留 1 MiB 余量，避免先解析超限请求。 */
const MAX_PROJECT_BYTES = 4 * 1024 * 1024;
const MAX_AUTOSAVES_PER_PROJECT = 3;
const MAX_NAME_LENGTH = 60;
const ID_PATTERN = /^p_[a-z0-9]+_[a-z0-9]+$/;

class ProjectError extends Error {
  constructor(message, code, status = 400, extra = {}) {
    super(message);
    this.name = 'ProjectError';
    this.code = code;
    this.status = status;
    Object.assign(this, extra);
  }
}

function emptyIndex() {
  return { version: INDEX_VERSION, activeId: null, activeClientId: null, activeAt: null, projects: [] };
}

function newProjectId() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function normalizeName(raw) {
  const cleaned = String(raw ?? '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  if (!cleaned) throw new ProjectError('工程名称不能为空', 'PROJECT_INVALID_NAME', 400);
  return cleaned;
}

function countSummary(data) {
  return {
    classes: Array.isArray(data?.classes) ? data.classes.length : 0,
    teachers: Array.isArray(data?.teachers) ? data.teachers.length : 0,
    coursePlans: Array.isArray(data?.coursePlans) ? data.coursePlans.length : 0,
  };
}

function openProjectStore({ dataDir, store, sanitize = (value) => value, validate = () => null, log = () => {} }) {
  const dir = path.join(dataDir, PROJECTS_SUBDIR);
  const autosaveDir = path.join(dir, AUTOSAVE_SUBDIR);
  const indexPath = path.join(dir, INDEX_FILE);
  fs.mkdirSync(dir, { recursive: true });

  // 单进程内串行化 index 的读-改-写。跨进程（桌面端与 Linux 指向同一 dataDir）
  // 不受保护，属于已知不支持场景。
  let chain = Promise.resolve();
  function withLock(task) {
    const next = chain.then(task, task);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  function readIndex() {
    if (!fs.existsSync(indexPath)) return emptyIndex();
    try {
      const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      const projects = Array.isArray(raw?.projects)
        ? raw.projects.filter((item) => item && typeof item.id === 'string' && ID_PATTERN.test(item.id))
        : [];
      return {
        version: Number(raw?.version) || INDEX_VERSION,
        activeId: typeof raw?.activeId === 'string' ? raw.activeId : null,
        activeClientId: typeof raw?.activeClientId === 'string' ? raw.activeClientId : null,
        activeAt: typeof raw?.activeAt === 'string' ? raw.activeAt : null,
        projects,
      };
    } catch (error) {
      log('warn', '工程清单损坏，已重置为空列表：' + error.message);
      return emptyIndex();
    }
  }

  function writeIndex(index) {
    writeJson(indexPath, { ...index, version: INDEX_VERSION });
    return index;
  }

  function projectFile(id) {
    if (!ID_PATTERN.test(String(id))) {
      throw new ProjectError('工程标识无效', 'PROJECT_NOT_FOUND', 404);
    }
    return path.join(dir, id + SNAPSHOT_EXT);
  }

  function findEntry(index, id) {
    return index.projects.find((item) => item.id === id) || null;
  }

  function requireEntry(index, id) {
    const entry = findEntry(index, id);
    if (!entry) throw new ProjectError('工程不存在或已被删除', 'PROJECT_NOT_FOUND', 404);
    return entry;
  }

  /** 读取工程快照（分片 ZIP）。 */
  function readDocument(id) {
    const file = projectFile(id);
    if (!fs.existsSync(file)) throw new ProjectError('工程快照文件缺失', 'PROJECT_NOT_FOUND', 404);
    let buffer;
    try {
      buffer = fs.readFileSync(file);
    } catch (error) {
      throw new ProjectError('工程包读取失败：' + error.message, 'PROJECT_CORRUPTED', 500);
    }
    try {
      return decodeSnapshot(buffer);
    } catch (error) {
      throw new ProjectError('工程包已损坏：' + error.message, 'PROJECT_CORRUPTED', 500);
    }
  }

  function writeFileAtomic(file, buffer) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, file);
  }

  /** 校验 + 清洗 + 体积检查，返回可直接落库的数据对象。 */
  function prepareData(data, { requireValid = true } = {}) {
    if (!data || typeof data !== 'object') {
      throw new ProjectError('工程数据格式无效', 'INVALID_DATA', 400);
    }
    sanitize(data);
    const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
    if (bytes > MAX_PROJECT_BYTES) {
      throw new ProjectError('工程数据超过 4 MB，请拆分或裁剪历史记录', 'PROJECT_TOO_LARGE', 413);
    }
    if (requireValid) {
      const error = validate(data);
      if (error) throw new ProjectError(error, 'INVALID_DATA', 400);
    }
    return { data, bytes };
  }

  /** 写分片 ZIP 快照，返回 manifest（含压缩后字节数与分片清单）。 */
  function writeSnapshot(id, name, data) {
    const { buffer, manifest } = encodeSnapshot(data, { name });
    writeFileAtomic(projectFile(id), buffer);
    return { ...manifest, bytes: buffer.length };
  }

  function autosave(id) {
    try {
      const file = projectFile(id);
      if (!fs.existsSync(file)) return;
      fs.mkdirSync(autosaveDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(file, path.join(autosaveDir, id + '-' + stamp + '.zip'));
      const owned = fs
        .readdirSync(autosaveDir)
        .filter((name) => name.startsWith(id + '-'))
        .sort();
      for (const stale of owned.slice(0, Math.max(0, owned.length - MAX_AUTOSAVES_PER_PROJECT))) {
        fs.rmSync(path.join(autosaveDir, stale), { force: true });
      }
    } catch (error) {
      log('warn', '写入工程自动备份失败：' + error.message);
    }
  }

  /** 工程快照是否落后于当前工作区。 */
  function isStale(entry) {
    if (!entry) return false;
    const current = store.read();
    return Boolean(current?.updatedAt && entry.syncedAt && current.updatedAt !== entry.syncedAt);
  }

  function list() {
    const index = readIndex();
    const active = findEntry(index, index.activeId);
    return {
      version: INDEX_VERSION,
      projects: index.projects,
      activeId: index.activeId,
      active: active ? { id: active.id, name: active.name, stale: isStale(active) } : null,
      limit: MAX_PROJECTS,
      maxProjectBytes: MAX_PROJECT_BYTES,
    };
  }

  function active() {
    const index = readIndex();
    const entry = findEntry(index, index.activeId);
    return {
      activeId: index.activeId,
      activeAt: index.activeAt,
      project: entry,
      stale: isStale(entry),
    };
  }

  function read(id) {
    const index = readIndex();
    const entry = requireEntry(index, id);
    return { project: entry, doc: readDocument(id) };
  }

  function create({ name, data, clientId = null, activate = false }) {
    const index = readIndex();
    if (index.projects.length >= MAX_PROJECTS) {
      throw new ProjectError('工程数量已达上限 ' + MAX_PROJECTS + ' 个，请先删除不用的工程', 'PROJECT_LIMIT_REACHED', 409);
    }
    const projectName = normalizeName(name);
    const { data: safeData } = prepareData(data);
    const id = newProjectId();
    const now = new Date().toISOString();
    const packed = writeSnapshot(id, projectName, safeData);
    const entry = {
      id,
      name: projectName,
      createdAt: now,
      updatedAt: now,
      syncedAt: activate ? now : null,
      // bytes = 压缩后的包体积（真实磁盘占用）；rawBytes = 解压后体积（受 4 MB 配额约束）
      bytes: packed.bytes,
      rawBytes: Buffer.byteLength(JSON.stringify(safeData), 'utf8'),
      schoolName: typeof safeData.school?.name === 'string' ? safeData.school.name : '',
      counts: countSummary(safeData),
    };
    index.projects.unshift(entry);
    if (activate) {
      const written = store.write(safeData);
      entry.syncedAt = written.updatedAt || now;
      index.activeId = id;
      index.activeClientId = clientId;
      index.activeAt = now;
    }
    writeIndex(index);
    return { project: entry, activeId: index.activeId };
  }

  function save(id, { data, name, clientId = null }) {
    const index = readIndex();
    const entry = requireEntry(index, id);
    const projectName = name === undefined ? entry.name : normalizeName(name);
    const { data: safeData } = prepareData(data);
    const packed = writeSnapshot(id, projectName, safeData);
    const now = new Date().toISOString();
    entry.name = projectName;
    entry.updatedAt = now;
    entry.bytes = packed.bytes;
    entry.rawBytes = Buffer.byteLength(JSON.stringify(safeData), 'utf8');
    entry.schoolName = typeof safeData.school?.name === 'string' ? safeData.school.name : '';
    entry.counts = countSummary(safeData);
    if (index.activeId === id) {
      // 保存到活动工程即视为已同步：记录与工作区一致的 updatedAt
      entry.syncedAt = typeof safeData.updatedAt === 'string' ? safeData.updatedAt : now;
      if (clientId) index.activeClientId = clientId;
    }
    writeIndex(index);
    return { project: entry };
  }

  function rename(id, name) {
    const index = readIndex();
    const entry = requireEntry(index, id);
    const projectName = normalizeName(name);
    entry.name = projectName;
    entry.updatedAt = new Date().toISOString();
    // 重命名要重写整个包：manifest 里的 name 是包内单一真源
    if (fs.existsSync(projectFile(id))) {
      const doc = readDocument(id);
      writeSnapshot(id, projectName, doc.data);
    }
    writeIndex(index);
    return { project: entry };
  }

  function remove(id) {
    const index = readIndex();
    requireEntry(index, id);
    fs.rmSync(projectFile(id), { force: true });
    index.projects = index.projects.filter((item) => item.id !== id);
    if (index.activeId === id) {
      index.activeId = null;
      index.activeAt = null;
      index.activeClientId = null;
    }
    writeIndex(index);
    return { ok: true, activeId: index.activeId };
  }

  function open(id, { expectedActiveId, saveCurrent = true, clientId = null, force = false } = {}) {
    const index = readIndex();
    const entry = requireEntry(index, id);

    // 1) 先把当前工作区写回其所属工程，并留一份自动备份（尽力而为）
    if (saveCurrent !== false && index.activeId && index.activeId !== id) {
      const previous = findEntry(index, index.activeId);
      if (previous) {
        try {
          const { data: safeData } = prepareData(store.read());
          const packed = writeSnapshot(previous.id, previous.name, safeData);
          previous.bytes = packed.bytes;
          previous.rawBytes = Buffer.byteLength(JSON.stringify(safeData), 'utf8');
          previous.updatedAt = new Date().toISOString();
          previous.syncedAt = store.read().updatedAt || previous.updatedAt;
          previous.counts = countSummary(safeData);
          previous.schoolName = typeof safeData.school?.name === 'string' ? safeData.school.name : previous.schoolName;
          autosave(previous.id);
        } catch (error) {
          log('warn', '切换工程前保存当前工程失败：' + error.message);
        }
      }
    }

    // 2) 并发切换检测：前端带上它读取到的 activeId，不匹配则要求确认
    if (expectedActiveId !== undefined && expectedActiveId !== index.activeId && !force) {
      const currentActive = findEntry(index, index.activeId);
      throw new ProjectError(
        '其他电脑已切换到「' + (currentActive?.name || '其他工程') + '」',
        'PROJECT_CONFLICT',
        409,
        { activeId: index.activeId },
      );
    }

    // 3) 换入：先写 warpweft.json，再写活动指针
    const doc = readDocument(id);
    const { data: safeData, bytes } = prepareData(doc.data);
    const written = store.write(safeData);
    entry.bytes = bytes;
    entry.counts = countSummary(safeData);
    entry.schoolName = typeof safeData.school?.name === 'string' ? safeData.school.name : entry.schoolName;
    entry.syncedAt = written.updatedAt || new Date().toISOString();
    index.activeId = id;
    index.activeClientId = clientId;
    index.activeAt = new Date().toISOString();
    writeIndex(index);
    return { project: entry, activeId: index.activeId, data: written };
  }

  function importWorkspace({ doc, name, clientId = null, activate = true }) {
    if (!doc || typeof doc !== 'object') {
      throw new ProjectError('工作区文件格式无效', 'WORKSPACE_FORMAT_INVALID', 400);
    }
    if (doc.format !== WORKSPACE_FORMAT) {
      throw new ProjectError('这不是 WarpWeft 工作区文件', 'WORKSPACE_FORMAT_INVALID', 400);
    }
    const version = Number(doc.version);
    if (!Number.isFinite(version) || version < 1 || version > WORKSPACE_VERSION) {
      throw new ProjectError(
        '工作区文件版本不受支持：v' + doc.version + '（本服务端支持 v' + WORKSPACE_VERSION + '）',
        'WORKSPACE_VERSION_UNSUPPORTED',
        400,
      );
    }
    const projectName = normalizeName(name || doc.name || '导入的工程');
    const { project } = create({ name: projectName, data: doc.data, clientId, activate });
    return { project, activeId: project.id };
  }

  return {
    dir,
    list,
    active,
    read,
    create: (payload) => withLock(() => create(payload)),
    save: (id, payload) => withLock(() => save(id, payload)),
    rename: (id, name) => withLock(() => rename(id, name)),
    remove: (id) => withLock(() => remove(id)),
    open: (id, options) => withLock(() => open(id, options)),
    importWorkspace: (payload) => withLock(() => importWorkspace(payload)),
  };
}

module.exports = {
  openProjectStore,
  ProjectError,
  WORKSPACE_FORMAT,
  WORKSPACE_VERSION,
  MAX_PROJECTS,
  MAX_PROJECT_BYTES,
};
