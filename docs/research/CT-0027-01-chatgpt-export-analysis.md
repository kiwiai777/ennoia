# CT-0027-01 — ChatGPT Export Data Analysis Report

> Generated: 2026-04-30
> Data: ~/data/chatgpt/conversations.json (49.8 MB)
> Task: CT-0027-01 (Design 卡 — Stage 20 ChatGPT adapter)
> Script: src/scripts/chatgpt-analysis/analyze.ts

---

## Schema Discovery

### Top-level structure

- File format: **JSON array** (顶层为 array，可流式解析 ✓)
- Streaming feasibility: **yes** — `stream-json` StreamArray works correctly on this file
- No special prefix/suffix — array starts at byte 0

### Conversation-level fields (sampled from first 10 conversations)

```
field                                   | presence
----------------------------------------|----------
  async_status                          | 10/10
  atlas_mode_enabled                    | 10/10
  context_scopes                        | 10/10
  conversation_id                       | 10/10
  conversation_origin                   | 10/10
  conversation_template_id              | 10/10
  create_time                           | 10/10
  current_node                          | 10/10
  default_model_slug                    | 10/10
  disabled_tool_ids                     | 10/10
  gizmo_type                            | 10/10
  id                                    | 10/10
  is_archived                           | 10/10
  is_do_not_remember                    | 10/10
  is_starred                            | 10/10
  mapping                               | 10/10
  memory_scope                          | 10/10
  moderation_results                    | 10/10
  title                                 | 10/10
  update_time                           | 10/10
  voice                                 | 10/10
```

All 21 top-level fields appear in 100% of sampled conversations. No sparse optional fields observed.

### Message node structure (`mapping[node_id]`)

Each mapping entry contains:
- `id` (string) — node UUID
- `message` (object | null) — the actual message
  - `author.role` (string): `"user"` | `"assistant"` | `"system"` | `"tool"`
  - `author.name` (string | null)
  - `content.content_type` (string): `"text"` | `"multimodal_text"` | `"tether_browsing_display"` | others
  - `content.parts` (array): text parts (strings) or image refs (objects)
  - `create_time` (number | null)
  - `metadata` (object): model_slug, finish_details, citations, etc.
- `parent` (string | null)
- `children` (array of string)

### Notable fields

- `gizmo_id` / `conversation_template_id`: present on GPT-based conversations (custom GPTs)
- `async_status`, `atlas_mode_enabled`, `context_scopes`: null in most cases
- `is_archived`, `is_starred`, `is_do_not_remember`: booleans/nulls
- `memory_scope`: present in all sampled conversations (null value) — ChatGPT memory scope tag
- `disabled_tool_ids`: array, usually empty

---

## Data Scale

### Overall

| Metric | Value |
|--------|-------|
| Total conversations | **91** |
| Time span | 2024-02 ~ 2026-04 |
| Total messages (all roles) | 9,311 |
| — user | 2,144 (23.0%) |
| — assistant | 3,540 (38.0%) |
| — system | 2,116 (22.7%) |
| — tool | 1,511 (16.2%) |
| Avg messages/conversation | 102.3 |
| Median messages/conversation | 28 |
| Max messages in one conversation | 809 |
| Total user message chars | 1.00 MB |
| Max user chars in one conversation | 160,967 |

### Time distribution (by conversation create_time)

```
2024-02: 27
2024-03: 2
2024-04: 1
2024-07: 1
2024-08: 2
2025-05: 2
2026-02: 13
2026-03: 24
2026-04: 19
```

**Observation:** There is a large cluster in 2024-02 (27 conversations) and then a gap until 2025-05.
The most active recent period is 2026-02 to 2026-04 (56 of 91 conversations = 62%).
2025 is largely absent — only 2 conversations in May 2025.

### User message length distribution (chars per conversation)

```
0-500          : 42 conversations (46.2%)
500-2000       : 19 conversations (20.9%)
2000-10000     : 10 conversations (11.0%)
10000-50000    : 12 conversations (13.2%)
50000+         :  8 conversations  (8.8%)
```

**Observation:** Nearly half of conversations (46%) have very short user messages (< 500 chars),
likely simple Q&A with low preference density. The 8 conversations above 50,000 user chars
are deeply technical discussions likely high in implicit preferences.

---

## Content Classification Sampling

### Top 30 title keywords

```
ai                  : 11
discussion          : 8
strategy            : 8
历史                  : 4
fashion             : 3
english             : 3
code                : 3
agent               : 3
stage               : 3
archives            : 3
decision            : 3
log                 : 3
内容流量运营              : 3
create              : 2
exploration         : 2
trends              : 2
improve             : 2
new                 : 2
gpt                 : 2
smartup             : 2
wsl                 : 2
claude              : 2
vs                  : 2
design              : 2
cortex              : 2
sora                : 2
video               : 2
character           : 1
portrait            : 1
amekaji             : 1
```

**Observation:** Heavy AI/tech focus (ai, agent, gpt, claude, cortex, code, stage), plus some Chinese
content (历史, 内容流量运营). Fashion, video, and creative topics also present. This confirms the user
uses ChatGPT primarily for technical/professional work — preference-density for those conversations
should be high.

### Sampled conversations (one per length bucket)

#### S1 (bucket: 0-500, user chars: 43)
- Title: "Create Character Portrait."
- First user msg: "Create a portrait of a fictional character."
- **Inference:** Simple creative request, no preferences, skip-worthy

#### S2 (bucket: 500-2000, user chars: 567)
- Title: "用户请求摘要"
- First user msg: "最新的时尚潮流新闻可以说一下嘛？"
- **Inference:** Factual query, likely low preference density

#### S3 (bucket: 50000+, user chars: 61,969)
- Title: "ComfyUI 使用与原理"
- First user msg: "什么叫fp8和fp16？我如何获取FP16/FP16-quant 或 FLUX.1 [schnell] 的标准版？"
- **Inference:** Deep technical discussion, likely contains "我倾向用X方案" type preferences

#### S4 (bucket: 10000-50000, user chars: 16,523)
- Title: "AI 编程模型选择"
- First user msg: "我用带 token 的 dashboard URL为什么现在打不开网页了？"
- **Inference:** Technical troubleshooting, probably contains workflow preference signals

#### S5 (bucket: 2000-10000, user chars: 2,883)
- Title: "OpenClaw 架构与应用"
- First user msg (first 200 chars): "https://mp.weixin.qq.com/s/... 看一下这个文章，现在clawhub上有很多skill..."
- **Inference:** Project design discussion, medium preference density

---

## Extraction Potential Assessment

### Keyword hit counts (all user messages across all conversations)

```
keyword              | hits  | samples (up to 3)
---------------------|-------|-------------------
我希望                  |     9 | "我希望简单点，让我更专注在和你一起把握方向架构上"
                      |       | "我希望之后每次给glm的任务输出...和sonnet模型的输出质量对比"
                      |       | "我希望：把执行工作尽可能交给 AI"
我喜欢                  |     6 | "我喜欢这个功能吗?" (in test context — likely false positive)
                      |       | "他说'我喜欢深色模式'" (quoted — false positive)
                      |       | "假如我喜欢这个方案呢" (hypothetical — false positive)
我倾向                  |     3 | "代码同步方案我倾向开发时直接挂在volume"
                      |       | "我倾向第二个方向"
                      |       | "第三点我倾向CLI选择"
我的目标                 |     3 | "我的目标是成为偏'系统架构与产品方向'的AI开发者"
                      |       | "我的目标是本周上线" (in a test/spec context — borderline)
我选择                  |     2 | "ow和PyTorch我选择哪个比较好" (query, not preference)
我打算                  |     1 | "我打算是在openclaw官方建议的skill入口建一个smartup文件夹"
我避免                  |     1 | "帮我避免环境坑和无效复杂度" (instruction to AI, not a preference)
I want to             |     1 | "I want to learn GPT and I will build the agent GPT"
```

**Total keyword hits:** 26
**Keywords with at least 1 hit:** 8 of 29 tested

### Conservative estimate

| Metric | Estimate | Basis |
|--------|----------|-------|
| Raw keyword hits | 26 | Direct count across all conversations |
| Genuine preference candidates (~40% of hits) | ~10 | Remove hypothetical/quoted/test uses |
| Unique preferences after dedup (~30% of candidates) | ~3 | Same preference stated multiple times |
| False positive rate | ~60% | Estimated: deterministic cannot distinguish real vs hypothetical |

### Key finding

The deterministic extractor gets 26 raw hits from 91 conversations, but on manual review,
many are false positives (quoted text, test fixtures, hypothetical framing).
**The high-value signal from ChatGPT export is likely in the long conversations (10,000+ chars)
but requires LLM review to surface genuine preferences.**

Example of genuine high-value hit found:
> "我的目标是成为偏'系统架构与产品方向'的AI开发者，而不是纯代码工程师。"
> — This is a clear, first-person professional goal statement.

---

## Risks and Open Questions

1. **Streaming library confirmed**: `stream-json` + `stream-chain` (npm) works with Node.js ESM + tsx.
   `streamArray()` correctly streams the 49.8 MB file without loading it all into memory. Viable.

2. **Time filter default**: Data spans 2024-02 ~ 2026-04 with a major gap (2024-09 to 2025-04).
   Recommend `--since` defaulting to **2025-01** (covers active period, skips old cluster)
   rather than "last 12 months" which would cut the important 2025-05 conversations.
   Alternatively, **--since 2025-01** as default with --all flag for full import.

3. **Role filter**: Only `user` messages contain first-person preference statements.
   `assistant` messages paraphrase user prefs ("As you mentioned...") but need LLM extraction.
   Deterministic should focus on `user` role only.

4. **Privacy**: ChatGPT export contains full conversation history.
   Cortex should not cache the raw data — only extracted facts should persist.
   The sync command must be ephemeral (read → extract → discard raw).

5. **Long conversation truncation**: Max user chars in one conversation = 160,967 chars (~32K tokens).
   Single conversations may exceed LLM context window. Need chunking strategy for those.

6. **Token budget (future LLM pass)**: 49.8 MB total cannot go to LLM. Suggested filter pipeline:
   (a) time filter → (b) length filter (skip < 500 chars) → (c) keyword pre-screen → (d) LLM only on hits.
   This reduces LLM input from 91 conversations to ~11.

7. **`content_type` variety**: Some messages use `"multimodal_text"` (image + text) or
   tool result types. Text extraction must handle non-string parts gracefully (skip objects).

8. **Data density is lower than expected**: Only 91 conversations total (vs "ChatGPT power user"
   expectations). The 2024-02 cluster (27 conversations) appears to be early exploration.
   Cortex ChatGPT sync may yield fewer unique preferences than Claude/Kimi export would.

---

## Recommendations

### 6.1 Adapter Design

| Decision | Recommendation | Basis |
|----------|----------------|-------|
| Parsing strategy | Stream with `stream-json` StreamArray | 49.8 MB; confirmed feasible, no OOM risk |
| Time filter default | `--since 2025-01` | Covers active period; skips sparse 2024 data |
| Role filter | User messages only for deterministic | System/tool messages carry no user prefs |
| Length filter | Skip conversations < 500 user chars | 46% of conversations, very low signal |
| LLM pass trigger | Conversations with ≥1 keyword hit | Reduces LLM scope from 91 → ~11 conversations |
| Content extraction | Text parts only (skip image refs) | Non-string parts carry no preference text |

### 6.2 Command Draft

```
cortex sync --from chatgpt-export <path>
   [--since YYYY-MM]              # default: 2025-01
   [--max-conversations N]        # safety cap, default: 500
   [--min-length N]               # default: 500 chars (user message chars)
   [--accept-all] [--dry-run]
```

### 6.3 Expected Output (first sync with defaults)

| Metric | Estimate |
|--------|----------|
| File conversations total | 91 |
| After time filter (≥ 2025-01) | ~56 (2026: 56 conversations) |
| After length filter (≥ 500 chars) | ~30 |
| Keyword-hit conversations (LLM candidates) | ~11 |
| Raw extraction candidates (deterministic) | ~10 |
| Unique preferences written to user_model | ~3–5 |
| Estimated runtime (streaming + deterministic) | < 5 seconds |
| Estimated runtime (+ LLM pass, if enabled) | 1–3 minutes |

**Bottom line:** ChatGPT export is a worthwhile source but data is sparse vs Claude. The adapter
is feasible to implement, and the LLM pass is strongly recommended for quality (deterministic alone
yields only ~3 genuine preferences from 91 conversations).

---

*Script: `src/scripts/chatgpt-analysis/analyze.ts`*
*Data: read-only, ~/data/chatgpt/conversations.json not modified*
