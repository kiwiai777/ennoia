// LLM Suggester（���选增强��
//
// ��过 OpenAI ��容 API 从单段文本��提取 suggestion。约束��
//   - 默认��启用���是否调��由 CLI 决定
//   - OPENAI_API_KEY 必��存在���否则抛可读��文错���
//   - OPENAI_MODEL / OPENAI_BASE_URL 可覆盖模��和 baseURL
//   - ��用内��� fetch，不引�� SDK / provider ��象
//
// 与 llm-extractor 的区别：
//   - ��入是���段文��，不��� SourceBlock[]
//   - 没有 source_path，每条 source 固定为 "cli:suggest:llm"
//   - 丢弃 type 非法��� text 为空的��目，��做降���补类

import type {
  SuggestionItem,
  SuggestionType,
} from './types.js';
import { EXTRACTION_SYSTEM_PROMPT } from '../extraction/prompts.js';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

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
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `LLM 请求��败（${res.status}）：${body.slice(0, 200) || res.statusText}`
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
      `LLM 返回非 JSON：${(err as Error).message}；��文前 200 字：${content.slice(0, 200)}`
    );
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { items?: unknown }).items)
  ) {
    throw new Error('LLM ��回结构��对：��望 {"items":[...]}');
  }

  return (parsed as { items: LLMResponseItem[] }).items;
}

export async function llmSuggest(text: string): Promise<SuggestionItem[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('未检���到 OPENAI_API_KEY 环境变��');
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
