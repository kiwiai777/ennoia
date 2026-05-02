// User Model 本地存储
// 位置：~/.cortex/user_model.json
//
// 策略：
//   - 读时做最小闭环校验（parseUserModel）：
//     * 顶层结构、schema_version、required 数组字段
//     * meta 子字段（sources / last_updated / confidence）
//     * 各数组项的基础字段（id / label / created_at / updated_at）
//   - 写时先写临时文件再 rename，保证写本身原子（同文件系统内 rename 为原子）
//   - 所有"读改写"走统一入口 updateUserModel(mutator)，避免调用方自己拼接
//
// 并发语义（重要）：
//   - 原子写入仅保证"写入那一刻"原子，不保证 read-modify-write 并发安全。
//   - updateUserModel 内部是顺序的 load → mutate → save，没有 CAS，也没有 lock。
//   - 当前只适用于单用户本地 CLI 场景。多进程 / 多写者并发需要另加 file lock
//     （例如 flock / proper-lockfile）或在 schema 里加 CAS 字段，后续再做。
//
// 依赖：仅 node:fs / node:path / node:os。不引入数据库和 schema 库。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { emptyUserModel, type UserModel } from './types.js';

const CORTEX_DIR = path.join(os.homedir(), '.cortex');
const USER_MODEL_PATH = path.join(CORTEX_DIR, 'user_model.json');

// user model 顶层数组字段；parseUserModel 会确保每个都是数组并逐项校验
const REQUIRED_ARRAY_FIELDS = [
  'projects',
  'goals',
  'preferences',
  'constraints',
  'skills',
  'states',
  'decision_rules',
] as const;

// 每个条目必须存在的字符串字段（最小数据契约）
const REQUIRED_ITEM_STRING_FIELDS = [
  'id',
  'label',
  'created_at',
  'updated_at',
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// 校验单个条目：必须是对象，且包含四个最小必需字符串字段。
// 不校验深层字段（description / scope / confidence 等）——由写入路径保证。
function assertItemShape(
  item: unknown,
  category: string,
  index: number
): void {
  if (!isPlainObject(item)) {
    throw new Error(`${category}[${index}] 必须是对象`);
  }
  for (const field of REQUIRED_ITEM_STRING_FIELDS) {
    if (typeof item[field] !== 'string') {
      throw new Error(
        `${category}[${index}] 缺少字符串字段 "${field}"`
      );
    }
  }
}

// 校验 meta 子字段形状
function assertMetaShape(meta: Record<string, unknown>): void {
  if (meta.last_updated !== null && typeof meta.last_updated !== 'string') {
    throw new Error('meta.last_updated 必须是字符串或 null');
  }
  if (!Array.isArray(meta.sources)) {
    throw new Error('meta.sources 必须是字符串数组');
  }
  for (let i = 0; i < meta.sources.length; i++) {
    if (typeof meta.sources[i] !== 'string') {
      throw new Error(`meta.sources[${i}] 必须是字符串`);
    }
  }
  if (meta.confidence !== null && typeof meta.confidence !== 'number') {
    throw new Error('meta.confidence 必须是数字或 null');
  }
}

// 轻量级校验入口：确保解析出来的对象具备 user model 的基础形状。
// 目的不是完整 JSON Schema 校验，而是避免拿到结构错乱的数据继续往下跑，
// 否则 save / render 阶段会抛出含义不清的 TypeError。
export function parseUserModel(raw: unknown): UserModel {
  if (!isPlainObject(raw)) {
    throw new Error('user model 必须是一个 JSON 对象');
  }

  if (raw.schema_version !== '0.1' && raw.schema_version !== '0.2') {
    throw new Error(
      `不支持的 schema_version: ${JSON.stringify(raw.schema_version)}（当前仅支持 "0.1"）`
    );
  }

  for (const field of REQUIRED_ARRAY_FIELDS) {
    const arr = raw[field];
    if (!Array.isArray(arr)) {
      throw new Error(`字段 "${field}" 缺失或不是数组`);
    }
    for (let i = 0; i < arr.length; i++) {
      assertItemShape(arr[i], field, i);
    }
  }

  if (!isPlainObject(raw.meta)) {
    throw new Error('字段 "meta" 缺失或不是对象');
  }
  assertMetaShape(raw.meta);

  return raw as unknown as UserModel;
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
//
// 注意：这里仅提供"写入那一刻"的原子性。调用方若自己 load → mutate → save，
// 与其他写者仍然会竞争——请通过 updateUserModel 入口。
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

// 统一写入口：load → 交给调用方 mutate → save。
// 所有"读改写"都应走这里，而不是在 CLI / adapter 里自行拼接。
//
// mutator 就地修改传入的 model。返回最终写入的 model 以便调用方打印 / 回显。
// 这里是未来加 file lock / CAS 的唯一边界点。
export function updateUserModel(
  mutator: (model: UserModel) => void
): UserModel {
  const model = loadUserModel();
  mutator(model);
  saveUserModel(model);
  return model;
}
