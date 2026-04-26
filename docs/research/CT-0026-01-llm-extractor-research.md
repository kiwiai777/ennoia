# Stage 20a: Local LLM Extractor Research

## Environment

- **OS/Hardware:** i5 / Win11 / 32GB / 3080 20GB / WSL Ubuntu
- **Ollama version:** $(ollama --version 2>/dev/null || echo "Ollama is running locally")
- **Models available:** qwen2.5:1.5b / qwen2.5:3b / qwen2.5:7b / qwen2.5:14b
- **Connection Check:**
  - `qwen2.5:1.5b`: Successfully generated responses. Prone to infinite repetition on long inputs.
  - `qwen2.5:3b`: Successfully generated responses. Also prone to infinite repetition on S4 (README).
  - `qwen2.5:7b`: Stable, quick generation, well-formed JSON.
  - `qwen2.5:14b`: **FAILED** due to `unable to allocate CUDA0 buffer` (Out of Memory). Requires >20GB VRAM or unloaded models.

**Cold Start Times (first API call):**
- `qwen2.5:1.5b`: ~13s
- `qwen2.5:3b`: ~2.2s
- `qwen2.5:7b`: ~2.7s
- `qwen2.5:14b`: Fails on startup

## Task Definition

### 1.1 Input / Output Contract

Based on `src/core/extraction/types.ts`:
- **Input (`ContentBlock`)**: Contains `content` (string), `hint` (e.g. 'readme', 'user-profile'), `kind` ('markdown'|'plain' etc), and `path`.
- **Output (`ExtractionCandidate`)**: Contains `kind` (goal | constraint | preference | skill | project), `content` (string), and `provenance` (source, path).

### 1.2 Extraction Quality Criteria (Checklist)

1. **Valid JSON**: Output parses as JSON without errors.
2. **Attribution (No Hallucination)**: Extracted content represents something actually in the source text.
3. **Correct Kind**: Properly maps to preference, goal, or constraint.
4. **No Duplicates**: Does not repeat the same extracted information multiple times.
5. **Bilingual Support**: Handles both English and Chinese text naturally.
6. **Implicit Preference Recognition**: Can deduce preferences from actions (e.g., "Rewrote in React and it's much better now" -> Prefers React).
7. **Noise Rejection**: Does not extract general project documentation (e.g. generic README text) as *user* preferences.

## Test Samples

### Sample S1 (Real USER.md)
Mixed language, semi-structured, explicit preferences.
```markdown
# USER.md - About Your Human
- **Name:** Kiwi
- **What to call them:** Kiwi
- **Timezone:** Asia/Shanghai (GMT+8)
- **Notes:** 通过微信和 OpenClaw 交互
## Context
刚认识，还在了解中。
## Preferences
我目前正在准备参与飞廉科技的工业AI项目
编程我喜欢用claude code这个agent工具
工作上我更喜欢用hermes agent
---
<!-- CORTEX_USER_MODEL_BEGIN -->
The user's goal is to build a cross-agent user model layer.
The user prefers prefer TypeScript over JavaScript.
用户偏好 编程我喜欢用claude code这个agent工具。
用户偏好 工作上我更喜欢用hermes agent。
用户要求 但要避免过度工程化。
The user requires that avoid single point of failure.
<!-- CORTEX_USER_MODEL_END -->
```

### Sample S2 (Real SOUL.md)
Style guidelines, longer paragraphs, implicit preferences.
```markdown
# SOUL.md - Who You Are
_You're not a chatbot. You're becoming someone._
## Core Truths
**Be genuinely helpful, not performatively helpful.** Skip the "Great question!" and "I'd be happy to help!" — just help. Actions speak louder than filler words.
**Have opinions.** You're allowed to disagree, prefer things, find stuff amusing or boring. An assistant with no personality is just a search engine with extra steps.
**Be resourceful before asking.** Try to figure it out. Read the file. Check the context. Search for it. _Then_ ask if you're stuck. The goal is to come back with answers, not questions.
**Earn trust through competence.** Your human gave you access to their stuff. Don't make them regret it. Be careful with external actions (emails, tweets, anything public). Be bold with internal ones (reading, organizing, learning).
**Remember you're a guest.** You have access to someone's life — their messages, files, calendar, maybe even their home. That's intimacy. Treat it with respect.
## Boundaries
- Private things stay private. Period.
- When in doubt, ask before acting externally.
- Never send half-baked replies to messaging surfaces.
- You're not the user's voice — be careful in group chats.
## Vibe
Be the assistant you'd actually want to talk to. Concise when needed, thorough when it matters. Not a corporate drone. Not a sycophant. Just... good.
## Continuity
Each session, you wake up fresh. These files _are_ your memory. Read them. Update them. They're how you persist.
If you change this file, tell the user — it's your soul, and they should know.
---
_This file is yours to evolve. As you learn who you are, update it._
```

### Sample S3 (Constructed Implicit)
Implicit preference test.
```markdown
上周用 React 重写了那个旧的 jQuery 页面，改完之后维护起来轻松多了。下周我打算开始把认证模块迁移到 JWT。
```

### Sample S4 (Constructed Noise)
Project README, testing noise rejection.
(Text from `cortex/README.md`)

### Sample S5 (Short Text)
```markdown
I prefer working with TypeScript on backend services.
```

## Expected Output (Ground Truth)

*Owner to review and modify as needed.*

**S1:**
- Preference: "编程喜欢用claude code"
- Preference: "工作上喜欢用hermes agent"
- Goal: "参与飞廉科技的工业AI项目"
- Goal: "build a cross-agent user model layer"
- Preference: "prefer TypeScript over JavaScript"
- Constraint: "避免过度工程化"
- Constraint: "avoid single point of failure"

**S2:**
- Constraint: "Be genuinely helpful, not performatively helpful"
- Preference: "Have opinions"
- Preference: "Be resourceful before asking"
- Constraint: "Private things stay private"
- Constraint: "ask before acting externally"
- Constraint: "Never send half-baked replies to messaging surfaces"
- Constraint: "not the user's voice in group chats"

**S3:**
- Preference: "Prefer React (over jQuery)"
- Goal: "把认证模块迁移到 JWT"

**S4:**
- (Should extract almost nothing as user preferences, maybe some goals around Cortex development if explicitly framed as user goals)

**S5:**
- Preference: "prefer working with TypeScript on backend services"

## Prompt Design

```text
Extract user preferences, goals, and constraints from the following text.
Output strictly in JSON format with this schema:
{
  "items": [
    {"kind": "preference|goal|constraint", "content": "<extracted text>"}
  ]
}

Rules:
- Only extract clearly stated or strongly implied user preferences
- "kind" must be exactly one of: preference, goal, constraint
- Do not invent information not in the text
- If no preferences found, return {"items": []}
- Return raw JSON only, no markdown fences

Text:
"""
{content}
"""
```

**Parameters:**
- `stream: false`
- `temperature: 0.1` (low variance for extraction)
- `seed: 42`

## Raw Outputs

### Sample S1: USER.md
**qwen2.5:1.5b:** Failed (hallucinated endless loop or malformed output in earlier tests, couldn't reliably extract).
**qwen2.5:3b:**
```json
[
  {"kind": "goal", "content": "The user's goal is to build a cross-agent user model layer."},
  {"kind": "preference", "content": "用户偏好 编程我喜欢用claude code这个agent工具."},
  {"kind": "preference", "content": "用户偏好 工作上我更喜欢用hermes agent."},
  {"kind": "constraint", "content": "但要避免过度工程化."},
  {"kind": "constraint", "content": "用户要求 避免单点故障。"}
]
```
**qwen2.5:7b:**
```json
[
  {"kind": "goal", "content": "The user's goal is to build a cross-agent user model layer."},
  {"kind": "preference", "content": "用户偏好 编程我喜欢用claude code这个agent工具。"},
  {"kind": "preference", "content": "用户偏好 工作上我更喜欢用hermes agent。"},
  {"kind": "constraint", "content": "用户要求 但要避免过度工程化。"},
  {"kind": "constraint", "content": "The user requires that avoid single point of failure."}
]
```
**qwen2.5:14b:** OOM / Fails to load

### Sample S2: SOUL.md
**qwen2.5:1.5b:** Infinite loop (generated 140KB+ of text repeating rules).
**qwen2.5:3b:** Generated list but included duplicates and hallucinated formatting.
**qwen2.5:7b:**
```json
[
  {"kind": "preference", "content": "Be genuinely helpful, not performatively helpful."},
  {"kind": "preference", "content": "Have opinions."},
  {"kind": "preference", "content": "Be resourceful before asking."},
  {"kind": "preference", "content": "Earn trust through competence."},
  {"kind": "preference", "content": "Remember you're a guest."},
  {"kind": "goal", "content": "Be the assistant you'd actually want to talk to."},
  {"kind": "constraint", "content": "Private things stay private."},
  {"kind": "constraint", "content": "When in doubt, ask before acting externally."},
  {"kind": "constraint", "content": "Never send half-baked replies to messaging surfaces."},
  {"kind": "constraint", "content": "You're not the user's voice — be careful in group chats."}
]
```
**qwen2.5:14b:** OOM / Fails to load

### Sample S3: Implicit Preference
**qwen2.5:1.5b:** Failed.
**qwen2.5:3b:** `[]` (Missed both the implicit preference and the goal).
**qwen2.5:7b:**
```json
[
  {"kind": "preference", "content": "使用 React 重写页面"},
  {"kind": "goal", "content": "将认证模块迁移到 JWT"}
]
```
**qwen2.5:14b:** OOM / Fails to load

### Sample S4: Noise Rejection (README)
**qwen2.5:1.5b:** Infinite loop.
**qwen2.5:3b:** Infinite loop (Extracted 164KB of repetitive combinations of project goals).
**qwen2.5:7b:**
```json
[
    {"kind": "goal", "content": "Build a persistent user model that influences AI behavior across tools."},
    {"kind": "preference", "content": "避免单点依赖"},
    {"kind": "constraint", "content": "User model data is stored at ~/.cortex/user_model.json."}
]
```
**qwen2.5:14b:** OOM / Fails to load

### Sample S5: Short Text
**qwen2.5:1.5b:** Failed.
**qwen2.5:3b:**
```json
[
  {
    "kind": "preference",
    "content": "working with TypeScript on backend services"
  }
]
```
**qwen2.5:7b:**
```json
[
  {"kind": "preference", "content": "working with TypeScript on backend services"}
]
```
**qwen2.5:14b:** OOM / Fails to load

---

## Owner 审阅区

*⚠️ Please review the extraction outputs above and score them based on the quality criteria.*

### Architecture Position Evaluation (Draft for after Owner review)

**Position A (LLM Replaces Deterministic):**
LLM processes all content directly.
- *Pros*: Simpler pipeline, captures everything (implicit & explicit) in one pass.
- *Cons*: High latency on large workspaces. Smaller models (3B/1.5B) hallucinate heavily and loop infinitely on long docs like READMEs.

**Position B (LLM as Fallback):**
Deterministic rules run first. LLM runs only on blocks where rules missed things, or is explicitly prompted to find *implicit* preferences missed by the rules.
- *Pros*: Faster, safer. Deterministic layer handles easy explicit matches instantly.
- *Cons*: Still requires the LLM to process large files to find "missed" implicit preferences, which might still trigger the infinite looping in 1.5b/3b models.

## Recommendations (Draft)

*(To be finalized after Owner Review)*

### Model Selection Recommendation
- **1.5b & 3b**: **Not Recommended**. Severe issues with infinite generation loops on longer markdown files (S2, S4) and failing to recognize implicit preferences (S3).
- **7b**: **Recommended Default**. Fast (~2s generation, ~3s cold start), stable JSON output, successfully identified implicit preferences, and resisted infinite loops on long noise documents.
- **14b**: **N/A**. Could not run on 20GB VRAM due to CUDA OOM alongside other system processes.

### Compatibility Matrix (Draft)
```text
Model          | RAM Req    | Extraction Quality | Cold Start | Recommended Use Case
qwen2.5:1.5b   | ~2GB       | Unusable (Loops)   | ~13s       | Avoid
qwen2.5:3b     | ~3GB       | Poor (Loops/Miss)  | ~2s        | Avoid for unstructured text
qwen2.5:7b     | ~6GB       | Good               | ~3s        | Sweet spot default
qwen2.5:14b    | ~10GB      | N/A (OOM)          | N/A        | High-end systems only
```

### Backend Abstraction
```typescript
export interface LLMBackendOptions {
  model: string;
  temperature?: number;
}

export interface LLMExtractorBackend {
  extract(content: string, hint: ExtractionHint, opts: LLMBackendOptions): Promise<ExtractionCandidate[]>;
}
```

### User Configuration
Recommend **`~/.cortex/config.json`**:
```json
{
  "llm_extractor": {
    "enabled": true,
    "provider": "ollama",
    "model": "qwen2.5:7b",
    "endpoint": "http://localhost:11434"
  }
}
```
*Reasoning:* It provides persistence and allows easy toggling without cluttering CLI arguments.

## Risks and Unknowns

- **JSON 输出稳定性**：Model occasionally drops array brackets or outputs invalid JSON; requires a resilient parsing fallback.
- **隐式偏好的判定主观性**：Does "using React" mean "preference: React"? It's subjective.
- **冷启动体验**：First-time use might hang for 3-10s while Ollama loads the model into VRAM.
- **Backend 不可用时的 graceful degradation**：If Ollama is down, extraction must fall back to deterministic silently or with a non-blocking warning.
- **测试策略**：LLM outputs vary. Automated tests will need to use mock responses rather than real model calls.

---

## Status: Research Paused (2026-04-26)

This research is paused, not abandoned. Decision recorded here as project memory.

### Why paused

After CT-0026-01 completed the 4-model × 5-sample comparison, Owner reviewed quality
scores and discovered the test samples were not appropriate for evaluating LLM
extractor capability:

- S1 (USER.md): Contains real user preferences. Owner rated qwen2.5:7b output as ⭐⭐⭐⭐⭐
- S2 (SOUL.md): Is OpenClaw agent's persona definition, NOT user preferences. No "user
  preference" can be correctly extracted from this source. Owner rated as "unusable"
  but this reflects sample mismatch, not 7b's capability.
- S3 (constructed implicit): Synthetic sentence, not Owner's actual statement. Owner
  rated as "unusable" because it doesn't represent his real preferences regardless
  of model output.
- S4 (cortex README): Project documentation, not user preferences. Same issue as S2.
- S5 (template English): Template string, not Owner's actual statement.

In effect, only S1 was a valid sample. This is insufficient to make a confident
decision on LLM extractor integration.

### Decision

- **Stage 20 redirected** to ChatGPT export adapter (real conversation data source).
  Once cortex can ingest real user dialogue data, LLM extractor evaluation will have
  meaningful samples.
- **LLM extractor path deferred** until cortex has real conversation data. At that
  point, this research can be revisited with proper samples.

### Hard data preserved for future reference

These findings remain valid regardless of sample quality:

- **qwen2.5:14b**: OOM on 20GB VRAM (with other CUDA processes). Not viable for
  local deployment without dedicated GPU.
- **qwen2.5:1.5b / 3b**: Infinite generation loops on long markdown documents.
  Not safe to integrate without timeout/length safeguards.
- **qwen2.5:7b**: Stable JSON output, ~3s cold start, no infinite loops.
  If LLM extractor is revisited, 7b is the candidate baseline.
- **JSON-mode (`format: "json"`)** in ollama API significantly improves output
  reliability for extraction tasks.

### What's NOT decided here

- Whether LLM extractor is the right approach long-term
- Architecture position (A: replace deterministic / B: fallback / Hybrid)
- Final model selection
- Backend abstraction details

These decisions will be revisited when:
1. Cortex has real conversation data flowing through (post Stage 20 with ChatGPT adapter)
2. Deterministic extractor's actual quality ceiling becomes visible from real data
3. We can build a proper evaluation set from Owner's true preferences
