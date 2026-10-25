#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { AuditLog, labelOf } = require('../server/api/audit.cjs');

const root = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.WARPVEFT_DATA_DIR || path.join(root, 'data'));
const userCli = path.join(__dirname, 'user-cli.cjs');
const audit = new AuditLog(path.join(dataDir, 'audit.log'));

function usage() {
  console.log(`用法:
  sudo warpweft user list
  sudo warpweft user add <用户名> [--admin]
  sudo warpweft user remove <用户名> [--yes]
  sudo warpweft user passwd <用户名>
  sudo warpweft user disable <用户名>
  sudo warpweft user enable <用户名>
  sudo warpweft task [用户名]
  sudo warpweft log [用户名] [--tail 100]
  sudo warpweft workspace clear [--yes]

user add 默认创建普通用户；加 --admin 创建管理员。
task 只列出已持久化的长时任务；log 读取 /var/lib/warpweft/audit.log。`);
}

function fail(message) {
  console.error('错误：' + message);
  process.exitCode = 1;
}

function runUserCli(command, username, extra = []) {
  const args = [userCli, command, username, ...extra].filter((item) => item !== undefined && item !== '');
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env, WARPVEFT_DATA_DIR: dataDir },
  });
  if (result.error) throw result.error;
  return result.status === 0;
}

function auditUser(action, username, detail = '') {
  audit.append({ actor: 'cli', action, target: username, detail });
}

function parseNumber(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function taskList(username) {
  const jobsDir = path.join(dataDir, 'solve-jobs');
  let files = [];
  try {
    files = fs.readdirSync(jobsDir).filter((name) => name.endsWith('.json') && !name.endsWith('.best.json'));
  } catch {
    console.log('没有任务目录：' + jobsDir);
    return;
  }
  const filter = String(username || '').trim().toLowerCase();
  const jobs = [];
  for (const file of files) {
    try {
      const job = JSON.parse(fs.readFileSync(path.join(jobsDir, file), 'utf8'));
      if (!job || typeof job.id !== 'string') continue;
      const owner = job.createdBy || '';
      if (filter && String(owner).toLowerCase() !== filter) continue;
      const progress = job.progress || {};
      jobs.push({ ...job, owner: owner || '（未记录）', placed: progress.placed, total: progress.total });
    } catch {
      // skip corrupt checkpoint
    }
  }
  jobs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  if (jobs.length === 0) {
    console.log(filter ? '用户 ' + username + ' 没有长时任务' : '没有长时任务');
    return;
  }
  console.log(['ID', '用户', '状态', '创建时间', '已排/总课时'].join('\t'));
  for (const job of jobs) {
    const placed = Number.isFinite(job.placed) ? job.placed : job.entryCount || 0;
    const total = Number.isFinite(job.total) ? job.total : job.lessons || 0;
    console.log([job.id, job.owner, job.status || '', job.createdAt || '', placed + '/' + total].join('\t'));
  }
}

function logList(username, tail) {
  const records = audit.read({ limit: tail, user: username });
  if (records.length === 0) {
    console.log(username ? '用户 ' + username + ' 没有操作记录' : '没有操作记录');
    return;
  }
  console.log(['时间', '操作人', '动作', '对象', '详情', 'IP'].join('\t'));
  for (const item of records) {
    const at = item.at ? new Date(item.at).toLocaleString('zh-CN', { hour12: false }) : '';
    console.log([
      at,
      item.actor || '',
      labelOf(item.action),
      item.target || '',
      item.detail || '',
      item.ip || '',
    ].join('\t'));
  }
}

function clearWorkspace() {
  const workspaceFile = path.join(dataDir, 'warpweft.json');
  const jobsDir = path.join(dataDir, 'solve-jobs');
  fs.rmSync(workspaceFile, { force: true });
  fs.rmSync(workspaceFile + '.bak', { force: true });
  fs.rmSync(jobsDir, { recursive: true, force: true });
  fs.mkdirSync(jobsDir, { recursive: true, mode: 0o750 });
  audit.append({
    actor: 'cli',
    action: 'workspace_clear',
    target: 'workspace',
    detail: '已删除 warpweft.json 与 solve-jobs',
  });
  console.log('工作区数据已清空；用户、密码和 server-config.json 未删除。');
}

function main() {
  const [scope, action, ...rest] = process.argv.slice(2);
  if (!scope || scope === '--help' || scope === '-h') {
    usage();
    return;
  }

  if (scope === 'user') {
    if (!action || action === 'list') {
      const ok = runUserCli('list', undefined);
      if (!ok) process.exitCode = 1;
      return;
    }
    const username = rest[0];
    if (!username) return fail('缺少用户名');
    if (action === 'add') {
      const isAdmin = rest.includes('--admin');
      const displayIndex = rest.indexOf('--display');
      const display = displayIndex >= 0 ? rest[displayIndex + 1] : undefined;
      if (runUserCli(isAdmin ? 'create-admin' : 'add-user', username, display ? [display] : [])) {
        auditUser('user_create', username, isAdmin ? 'role=admin' : 'role=user');
      } else {
        process.exitCode = 1;
      }
      return;
    }
    if (action === 'passwd' || action === 'reset-password') {
      if (runUserCli('reset-password', username)) auditUser('password_reset', username, 'by=cli');
      else process.exitCode = 1;
      return;
    }
    if (action === 'remove' || action === 'delete') {
      if (runUserCli('remove', username)) auditUser('user_delete', username);
      else process.exitCode = 1;
      return;
    }
    if (action === 'disable' || action === 'enable') {
      if (runUserCli(action, username)) auditUser('user_update', username, 'disabled=' + (action === 'disable'));
      else process.exitCode = 1;
      return;
    }
    return fail('未知用户命令：' + action);
  }

  if (scope === 'task' || scope === 'tasks') {
    taskList(action && !action.startsWith('--') ? action : undefined);
    return;
  }

  if (scope === 'log' || scope === 'logs') {
    let username;
    let tail = 100;
    const args = process.argv.slice(2);
    for (let index = 1; index < args.length; index += 1) {
      const value = args[index];
      if (value === '--tail' || value === '-n') {
        tail = parseNumber(args[index + 1], tail);
        index += 1;
      } else if (!value.startsWith('--')) {
        username = value;
      }
    }
    logList(username, tail);
    return;
  }

  if (scope === 'workspace') {
    if (action === 'clear' || action === 'reset') {
      clearWorkspace();
      return;
    }
    return fail('未知工作区命令：' + (action || ''));
  }

  fail('未知命令：' + scope);
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
