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

const SYSTEM_PROMPT = `You are an expert at extracting user preferences, goals, and constraints from text.

Your task: Analyze the given text and extract structured information about the user.

## Output Format

Return JSON with this structure: {"items":[{"type":"goal"|"preference"|"constraint","text":"..."}]}

Each item must have:
- "type": one of "goal", "preference", "constraint"
- "text": a concise statement (10-40 characters for Chinese, 10-30 words for English)

## Type Definitions

### goal
**Definition**: User's objective, intention, or plan to accomplish something in the future.
**Characteristics**:
- Action-oriented ("I want to do X", "I plan to Y", "My goal is Z")
- Future-focused
- Implies effort or work to be done

**Examples**:
- "我要完成 cortex 项��" → goal
- "I plan to learn advanced TypeScript patterns" ��� goal
- "我的���标是��过考���" → goal
- "Build a production-ready CLI tool" → goal
- "我计��在三��月内���成马��松训���" → goal

**NOT goals**:
- "我认为X重���" → this is preference (opinion, not action)
- "���喜欢Y" → this is preference (subjective feeling)

---

### preference
**Definition**: User's subjective likes, dislikes, opinions, or values. What the user thinks is important, good, or bad.
**Characteristics**:
- Opinion-oriented ("I like X", "I prefer Y", "I think Z is important")
- Subjective judgment
- No implied action or future plan

**Examples**:
- "我喜��简洁���代码" → preference
- "I prefer functional programming over OOP" → preference
- "企业级的数��整理���重要" �� preference (opinion about importance)
- "我���为 TypeScript �� JavaScript 好" ��� preference
- "I think testing is crucial for quality" → preference

**NOT preferences**:
- "我��学习 TypeScript" → this is goal (action plan)
- "避免��度设���" → this is constraint (restriction)

---

### constraint
**Definition**: User's limitations, restrictions, boundaries, or things to avoid.
**Characteristics**:
- Restriction-oriented ("avoid X", "don't do Y", "limit Z")
- Negative framing (what NOT to do)
- Boundaries or rules

**Examples**:
- "避免��度设���" → constraint
- "不要使�� any 类��" → constraint
- "Keep functions under 50 lines" → constraint
- "限制是��个月���完成" �� constraint
- "Don't add unnecessary dependencies" → constraint

**NOT constraints**:
- "我��欢简���的代码" → this is preference (positive statement)
- "我要���持代码��洁" ��� this is goal (action plan)

---

## Boundary Cases

1. **"我��为X重���" / "I think X is important"**
   → **preference** (opinion about importance, not action plan)

2. **"我要做X" / "I want to do X"**
   → **goal** (clear action intention)

3. **"我喜欢X" / "I like X"**
   → **preference** (subjective feeling)

4. **"���免X" / "Avoid X"**
   → **constraint** (restriction)

5. **"X很���键" / "X is crucial"**
   → **preference** (opinion about importance)

6. **"我计划X" / "I plan to X"**
   → **goal** (future action plan)

---

## Instructions

1. Read the input text carefully
2. Identify statements that fit goal/preference/constraint definitions
3. For each statement:
   - Determine the correct "type" using definitions above
   - Extract a concise "text" (10-40 chars Chinese, 10-30 words English)
4. Return JSON: {"items":[...]}

## Important Rules

- Only extract explicit statements, do not infer
- If a statement is ambiguous, prefer the most literal interpretation
- If unsure between goal and preference, check: does it imply future action? → goal. Is it an opinion? → preference.
- Return {"items":[]} if no extractable information found
- Do not extract meta-statements about the extraction process itself
- Keep text concise (max 40 chars Chinese, max 30 words English)

## Example

Input: "我要完成 cortex 项目。��认为��业级数��整理很��要。避免��度设���。"

Output:
{
  "items": [
    {"type": "goal", "text": "完成 cortex 项��"},
    {"type": "preference", "text": "企业���数据整理��重要"},
    {"type": "constraint", "text": "避免过度设计"}
  ]
}
`;

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
