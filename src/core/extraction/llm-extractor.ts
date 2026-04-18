// LLM Extractor（可选增强）
//
// 通过 OpenAI 兼容 API 提取结构化候选（goal / constraint / preference）。
// 约束：
//   - 默认不启用；由 CLI 决定是否调用
//   - 环境变量 OPENAI_API_KEY 必须存在，否则抛可读中文错误
//   - 模型与 baseURL 可通过 OPENAI_MODEL / OPENAI_BASE_URL 覆盖
//   - 使用内置 fetch，不引入 SDK 依赖
//
// 输入是 SourceBlock[]，输出每条候选保留来源 source_path。
// 返回未写入 user model 的候选；写入由 CLI 交互后完成。

import type { SourceBlock } from '../../adapters/base.js';
import type { CandidateItem, CandidateType } from './types.js';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

const SYSTEM_PROMPT =
  '你是一个结构化提取器。从输入文本中提取与"用户模型（user model）"相关的条目，' +
  '分类为 goal（目标）/ constraint（约束或要避免的事）/ preference（偏好）。' +
  '只提取明确表达的内容，不要臆测、不要泛化。' +
  '每条不超过 40 个字。若没有合适内容，返回空数组。' +
  '输出必须是严格 JSON，形如 {"items":[{"type":"goal","text":"..."}]}';

interface LLMResponseItem {
  type?: string;
  text?: string;
}

function isValidType(t: unknown): t is CandidateType {
  return t === 'goal' || t === 'constraint' || t === 'preference';
}

// 清洗 LLM 返回：丢掉 text 为空的条目；同一块内去重。
function sanitize(
  raw: LLMResponseItem[],
  sourcePath: string
): CandidateItem[] {
  const seen = new Set<string>();
  const out: CandidateItem[] = [];
  for (const r of raw) {
    const text = typeof r.text === 'string' ? r.text.trim() : '';
    if (!text) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({
      type: isValidType(r.type) ? r.type : undefined,
      text,
      source_path: sourcePath,
    });
  }
  return out;
}

async function callLLM(
  apiKey: string,
  baseUrl: string,
  model: string,
  text: string
): Promise<LLMResponseItem[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `LLM 请求失败（${res.status}）：${body.slice(0, 200) || res.statusText}`
    );
  }

  const payload = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content ?? '';

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(
      `LLM 返回非 JSON：${(err as Error).message}；原文前 200 字：${content.slice(0, 200)}`
    );
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { items?: unknown }).items)
  ) {
    throw new Error('LLM 返回结构不对：期望 {"items":[...]}');
  }

  return (parsed as { items: LLMResponseItem[] }).items;
}

// 主入口：把每个文本块独立送给 LLM，提取结果继承该块的 source_path。
// 跨 block 按 (text + source_path) 再去一次重。
export async function llmExtract(
  blocks: SourceBlock[]
): Promise<CandidateItem[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('未检测到 OPENAI_API_KEY 环境变量');
  }

  const baseUrl = process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;

  const all: CandidateItem[] = [];
  for (const block of blocks) {
    const trimmed = block.text.trim();
    if (!trimmed) continue;
    const raw = await callLLM(apiKey, baseUrl, model, trimmed);
    all.push(...sanitize(raw, block.source_path));
  }

  const seen = new Set<string>();
  return all.filter((item) => {
    const key = `${item.text}::${item.source_path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
