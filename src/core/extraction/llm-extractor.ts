// LLM Extractor（可选增强）
//
// 通过 OpenAI 兼容 API 提取结构化候选（goal / constraint / preference）。
// 约束：
//   - 默认不启用；由 CLI 决定是否调用
//   - 环境变量 OPENAI_API_KEY 必须存在，否则抛可读中文错误
//   - 模型与 baseURL 可通过 OPENAI_MODEL / OPENAI_BASE_URL 覆盖
//   - 使用内置 fetch，不引入 SDK 依赖
//
// 返回未写入 user model 的候选；写入由 CLI 交互后完成。

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

// 清洗 LLM 返回：丢掉 type 非法 / text 为空的条目；去重。
function sanitize(raw: LLMResponseItem[]): CandidateItem[] {
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

// 主入口：把多个文本块逐个送给 LLM，合并所有候选。
// 失败方式：任一块调用失败立即抛出，由 CLI 层统一处理。
export async function llmExtract(blocks: string[]): Promise<CandidateItem[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('未检测到 OPENAI_API_KEY 环境变量');
  }

  const baseUrl = process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;

  const all: CandidateItem[] = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const raw = await callLLM(apiKey, baseUrl, model, trimmed);
    all.push(...sanitize(raw));
  }

  // 跨 block 再去重一次（按 text）
  const seen = new Set<string>();
  return all.filter((item) => {
    if (seen.has(item.text)) return false;
    seen.add(item.text);
    return true;
  });
}
