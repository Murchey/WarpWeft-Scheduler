#!/usr/bin/env node
/**
 * Linux-only user administration CLI. The desktop Electron API never enables
 * this store; it is used by the Linux service and by administrators on the
 * server host.
 */
const fs = require('node:fs');
const path = require('node:path');
const { UserStore, validatePassword, validateUsername } = require('../server/api/auth.cjs');

const root = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.WARPVEFT_DATA_DIR || path.join(root, 'data'));
const usersFile = path.join(dataDir, 'users.json');

function usage() {
  console.log(`Usage:
  WARPVEFT_DATA_DIR=/var/lib/warpweft node linux_server/user-cli.cjs list
  WARPVEFT_DATA_DIR=/var/lib/warpweft node linux_server/user-cli.cjs create-admin <username> [displayName]
  WARPVEFT_DATA_DIR=/var/lib/warpweft node linux_server/user-cli.cjs add-user <username> [displayName]
  WARPVEFT_DATA_DIR=/var/lib/warpweft node linux_server/user-cli.cjs reset-password <username>
  WARPVEFT_DATA_DIR=/var/lib/warpweft node linux_server/user-cli.cjs disable <username>
  WARPVEFT_DATA_DIR=/var/lib/warpweft node linux_server/user-cli.cjs enable <username>
  WARPVEFT_DATA_DIR=/var/lib/warpweft node linux_server/user-cli.cjs remove <username>

Run as the service user (usually): sudo -u warpweft env WARPVEFT_DATA_DIR=/var/lib/warpweft node ...
For automation, set WARPVEFT_USER_PASSWORD; otherwise the command prompts twice without echo.`);
}

function readStdinLine() {
  try {
    return fs.readFileSync(0, 'utf8').split(/\r?\n/)[0] || '';
  } catch {
    return '';
  }
}

function readSecret(label) {
  if (process.env.WARPVEFT_USER_PASSWORD) return Promise.resolve(process.env.WARPVEFT_USER_PASSWORD);
  if (!process.stdin.isTTY) {
    const value = readStdinLine();
    if (!value) return Promise.reject(new Error('非交互模式需要通过 WARPVEFT_USER_PASSWORD 提供密码'));
    return Promise.resolve(value);
  }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = '';
    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };
    const onData = (chunk) => {
      for (const char of String(chunk)) {
        if (char === '\u0003') {
          cleanup();
          stdout.write('\n');
          reject(new Error('已取消'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u007f') {
          if (value) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }
        value += char;
        stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

async function readConfirmedPassword() {
  const first = await readSecret('密码: ');
  const reason = validatePassword(first);
  if (reason) throw new Error(reason);
  if (!process.env.WARPVEFT_USER_PASSWORD) {
    const second = await readSecret('确认密码: ');
    if (first !== second) throw new Error('两次输入的密码不一致');
  }
  return first;
}

function printUsers(users) {
  if (users.length === 0) {
    console.log('还没有用户。先创建管理员：create-admin <username>');
    return;
  }
  for (const user of users) {
    console.log(
      [user.username, user.role, user.disabled ? 'disabled' : 'active', user.displayName, user.id].join('\t'),
    );
  }
}

async function main() {
  const [command, username, displayName] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    usage();
    return;
  }
  const store = new UserStore(usersFile);

  if (command === 'list') {
    printUsers(store.list());
    return;
  }
  if (!username) throw new Error('缺少用户名');
  const usernameError = validateUsername(username);
  if (usernameError) throw new Error(usernameError);
  const existing = store.findByUsername(username);

  if (command === 'create-admin' || command === 'add-user') {
    if (existing) throw new Error('用户名已存在');
    const password = await readConfirmedPassword();
    const role = command === 'create-admin' ? 'admin' : 'user';
    const user = store.create({ username, password, role, displayName: displayName || undefined });
    console.log('已创建用户：' + user.username + '（' + user.role + '）');
    return;
  }

  if (!existing) throw new Error('用户不存在：' + username);
  if (command === 'reset-password') {
    const password = await readConfirmedPassword();
    store.update(existing.id, { password });
    console.log('已重置密码：' + existing.username);
    return;
  }
  if (command === 'disable') {
    store.update(existing.id, { disabled: true });
    console.log('已禁用：' + existing.username);
    return;
  }
  if (command === 'enable') {
    store.update(existing.id, { disabled: false });
    console.log('已启用：' + existing.username);
    return;
  }
  if (command === 'remove') {
    store.remove(existing.id);
    console.log('已删除：' + existing.username);
    return;
  }
  throw new Error('未知命令：' + command);
}

main().catch((error) => {
  console.error('错误：' + (error instanceof Error ? error.message : error));
  process.exitCode = 1;
});
