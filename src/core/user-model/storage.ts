// User Model 本地存储
// 位置：~/.cortex/user_model.json
// 策略：读时自动初始化，写时原子覆盖。不引入数据库。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { emptyUserModel, type UserModel } from './types.js';

const CORTEX_DIR = path.join(os.homedir(), '.cortex');
const USER_MODEL_PATH = path.join(CORTEX_DIR, 'user_model.json');

export function getCortexDir(): string {
  return CORTEX_DIR;
}

export function getUserModelPath(): string {
  return USER_MODEL_PATH;
}

function ensureDir(): void {
  if (!fs.existsSync(CORTEX_DIR)) {
    fs.mkdirSync(CORTEX_DIR, { recursive: true });
  }
}

// 读取 user model；文件不存在时以空模型初始化并写入
export function loadUserModel(): UserModel {
  if (!fs.existsSync(USER_MODEL_PATH)) {
    const empty = emptyUserModel();
    saveUserModel(empty);
    return empty;
  }
  const raw = fs.readFileSync(USER_MODEL_PATH, 'utf-8');
  try {
    return JSON.parse(raw) as UserModel;
  } catch (err) {
    throw new Error(
      `user_model.json 解析失败（${USER_MODEL_PATH}）：${(err as Error).message}`
    );
  }
}

// 覆盖写入 user model（美化 JSON，保留末尾换行）
export function saveUserModel(model: UserModel): void {
  ensureDir();
  const json = JSON.stringify(model, null, 2);
  fs.writeFileSync(USER_MODEL_PATH, json + '\n', 'utf-8');
}
