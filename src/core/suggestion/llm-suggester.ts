// LLM Suggester（可选增强）
//
// 通过 OpenAI 兼容 API 从单段文本中提取 suggestion。约束：
//   - 默认不启用；是否调用由 CLI 决定
//   - OPENAI_API_KEY 必须存在，否则抛可读中文错误
//   - OPENAI_MODEL / OPENAI_BASE_URL 可覆盖模型和 baseURL
//   - 使用内置 fetch，不引入 SDK / provider 抽象
//
// 与 llm-extractor 的区别：
//   - 输入是单段文本，不是 SourceBlock[]
//   - 没有 source_path，每条 source 固定为 "cli:suggest:llm"
//   - 丢弃 type 非法或 text 为空的条目，不做降级补类

import type {
  SuggestionItem,
  SuggestionType,
} from './types.js';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

const SYSTEM_PROMPT =
  '你是一个结构化提取器。从输入文本中提取与"用户模型（user model）"相关的条目，' +
  '分类为 goal（目标）/ constraint（约束或要避免的事）/ preference（偏好）。' +
  '只提取明确表达的内容，不要臆测、不要泛化。' +
  '每条不超过 40 个字。若没有合适内容，返回空数组。' +
  '输出必须是严格 JSON，形如 {"items":[{"type":"goal","text":"..."}]}';

interface LLMResponseItem {
  type?: unknown;
  text?: unknown;
}

function isValidType(t: unknown): t is SuggestionType {
  return t === 'goal' || t === 'constraint' || t === 'preference';
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

export async function llmSuggest(text: string): Promise<SuggestionItem[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('未检测到 OPENAI_API_KEY 环境变量');
  }

  const baseUrl = process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;

  const trimmed = text.trim();
  if (!trimmed) return [];

  const raw = await callLLM(apiKey, baseUrl, model, trimmed);

  const seen = new Set<string>();
  const out: SuggestionItem[] = [];
  for (const r of raw) {
    if (!isValidType(r.type)) continue;
    const t = typeof r.text === 'string' ? r.text.trim() : '';
    if (!t) continue;

    const key = `${r.type}::${t.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      type: r.type,
      text: t,
      source: 'cli:suggest:llm',
    });
  }

  return out;
}
