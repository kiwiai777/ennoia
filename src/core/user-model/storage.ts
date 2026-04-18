// User Model 本地存储
// 位置：~/.cortex/user_model.json
// 策略：
//   - 读时校验 schema_version + 基础字段（parseUserModel）
//   - 写时先写临时文件再 rename，保证原子性（同文件系统内 rename 为原子操作）
// 不引入数据库，不引入 schema 校验库（依赖最小）。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { emptyUserModel, type UserModel } from './types.js';

const CORTEX_DIR = path.join(os.homedir(), '.cortex');
const USER_MODEL_PATH = path.join(CORTEX_DIR, 'user_model.json');

// user model 顶层数组字段；parseUserModel 会确保每个都是数组
const REQUIRED_ARRAY_FIELDS = [
  'projects',
  'goals',
  'preferences',
  'constraints',
  'skills',
  'states',
  'decision_rules',
] as const;

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

// 轻量级校验入口：确保解析出来的对象具备 user model 的基础形状。
// 目的不是完整 JSON Schema 校验，而是避免拿到结构错乱的数据继续往下跑。
export function parseUserModel(raw: unknown): UserModel {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('user model 必须是一个 JSON 对象');
  }
  const obj = raw as Record<string, unknown>;

  if (obj.schema_version !== '0.1') {
    throw new Error(
      `不支持的 schema_version: ${JSON.stringify(obj.schema_version)}（当前仅支持 "0.1"）`
    );
  }

  for (const field of REQUIRED_ARRAY_FIELDS) {
    if (!Array.isArray(obj[field])) {
      throw new Error(`字段 "${field}" 缺失或不是数组`);
    }
  }

  if (
    typeof obj.meta !== 'object' ||
    obj.meta === null ||
    Array.isArray(obj.meta)
  ) {
    throw new Error('字段 "meta" 缺失或不是对象');
  }

  // 到这里已经可以安全当作 UserModel 使用。
  // 深层字段（id / label / created_at）当前不做强校验，
  // 由写入路径保证；必要时再扩展。
  return obj as unknown as UserModel;
}

// 读取 user model；文件不存在时以空模型初始化并写入
export function loadUserModel(): UserModel {
  if (!fs.existsSync(USER_MODEL_PATH)) {
    const empty = emptyUserModel();
    saveUserModel(empty);
    return empty;
  }

  const raw = fs.readFileSync(USER_MODEL_PATH, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `user_model.json JSON 解析失败（${USER_MODEL_PATH}）：${(err as Error).message}`
    );
  }

  return parseUserModel(parsed);
}

// 原子写入：写到临时文件再 rename 到目标路径。
// 崩溃 / 并发下最坏情况是留下 .tmp 文件，但目标文件不会半写半旧。
export function saveUserModel(model: UserModel): void {
  ensureDir();
  const json = JSON.stringify(model, null, 2) + '\n';

  const tmpPath = `${USER_MODEL_PATH}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, USER_MODEL_PATH);
  } catch (err) {
    // 失败时清理临时文件，避免污染 ~/.cortex 目录
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // 清理失败不覆盖原始错误
    }
    throw err;
  }
}
