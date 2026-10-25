'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_READ = 10000;

/**
 * Append-only JSONL audit log for Linux account and job operations. It is
 * deliberately separate from the in-memory server log so a restart does not
 * erase who changed users or started jobs.
 */
class AuditLog {
  constructor(file) {
    this.file = file;
  }

  append(entry = {}) {
    const record = {
      at: new Date().toISOString(),
      actor: String(entry.actor || 'unknown').slice(0, 128),
      action: String(entry.action || 'unknown').slice(0, 64),
      target: entry.target ? String(entry.target).slice(0, 256) : null,
      detail: entry.detail ? String(entry.detail).slice(0, 2000) : '',
      ip: entry.ip ? String(entry.ip).slice(0, 128) : null,
    };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      this.rotateIfNeeded();
      fs.appendFileSync(this.file, JSON.stringify(record) + '\n', { encoding: 'utf8', mode: 0o600 });
      try {
        fs.chmodSync(this.file, 0o600);
      } catch {
        // best effort on filesystems without POSIX modes
      }
    } catch {
      // Auditing must never break login or scheduling.
    }
    return record;
  }

  rotateIfNeeded() {
    try {
      const stat = fs.statSync(this.file);
      if (stat.size < MAX_BYTES) return;
      fs.renameSync(this.file, this.file + '.1');
    } catch {
      // file does not exist yet
    }
  }

  read(options = {}) {
    const limit = Math.max(1, Math.min(MAX_READ, Number(options.limit) || 100));
    const filter = String(options.user || '').trim().toLowerCase();
    let text = '';
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {
      return [];
    }
    const records = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (filter) {
          const actor = String(item.actor || '').toLowerCase();
          const target = String(item.target || '').toLowerCase();
          if (actor !== filter && target !== filter) continue;
        }
        records.push(item);
      } catch {
        // skip a truncated/corrupt line instead of hiding all history
      }
    }
    return records.slice(-limit);
  }
}

const ACTION_LABELS = {
  login: '登录',
  login_failed: '登录失败',
  login_rate_limited: '登录限流',
  logout: '退出登录',
  password_change: '修改密码',
  password_reset: '重置密码',
  user_create: '创建用户',
  user_update: '修改用户',
  user_delete: '删除用户',
  job_create: '创建长时任务',
  job_pause: '暂停任务',
  job_resume: '继续任务',
  job_cancel: '取消任务',
  job_delete: '删除任务',
  workspace_clear: '清空工作区',
};

function labelOf(action) {
  return ACTION_LABELS[action] || action;
}

module.exports = { AuditLog, ACTION_LABELS, labelOf };
