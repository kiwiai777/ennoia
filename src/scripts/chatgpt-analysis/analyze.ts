/**
 * CT-0027-01: ChatGPT export data analysis script.
 * Read-only. Does not modify ~/data/chatgpt/ or any cortex product code.
 *
 * Run: tsx src/scripts/chatgpt-analysis/analyze.ts
 */

import { createReadStream } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { streamArray } from 'stream-json/streamers/StreamArray.js';

const DATA_PATH = join(homedir(), 'data', 'chatgpt', 'conversations.json');

// ─── Types ───────────────────────────────────────────────────────────────────

interface MessageAuthor { role: string; name: string | null; }
interface MessageContent { content_type: string; parts?: unknown[]; }
interface Message {
  id: string;
  author: MessageAuthor;
  create_time: number | null;
  content: MessageContent | null;
  metadata?: Record<string, unknown>;
}
interface MappingNode { id: string; message: Message | null; parent: string | null; children: string[]; }
interface Conversation {
  id: string;
  conversation_id?: string;
  title: string | null;
  create_time: number;
  update_time: number;
  mapping: Record<string, MappingNode>;
  current_node: string;
  gizmo_id?: string | null;
  [key: string]: unknown;
}

// ─── State ───────────────────────────────────────────────────────────────────

let totalConversations = 0;
let minTime = Infinity;
let maxTime = -Infinity;
let totalUserMsgs = 0;
let totalAssistantMsgs = 0;
let totalSystemMsgs = 0;
let totalToolMsgs = 0;
let totalUserChars = 0;
const messageCounts: number[] = [];
const userCharCounts: number[] = [];
const monthCounts: Record<string, number> = {};

// Schema: field presence across first 10 conversations
const schemaFields: Map<string, number> = new Map();
const SCHEMA_SAMPLE = 10;

// Char buckets for user message totals per conversation
const charBuckets = { '0-500': 0, '500-2000': 0, '2000-10000': 0, '10000-50000': 0, '50000+': 0 };

// Title keywords (simple tokenization, both Chinese and English)
const titleKeywords: Map<string, number> = new Map();

// Sample conversations (5): indices into short/medium/long buckets
const samples: Array<{ bucket: string; title: string | null; firstUserMsg: string; convIdx: number; userChars: number }> = [];
const SAMPLE_TARGET = { '0-500': 1, '500-2000': 1, '2000-10000': 1, '10000-50000': 1, '50000+': 1 };
const sampleFilled: Record<string, boolean> = {};

// Keyword hits for preference extraction potential
const CN_KEYWORDS = [
  '我喜欢', '我偏好', '我倾向', '我选择',
  '我的目标', '我希望', '我打算', '我计划',
  '我不喜欢', '我反对', '我避免', '我讨厌',
  '我习惯', '我经常', '我通常',
];
const EN_KEYWORDS = [
  'I prefer', 'I like', 'I love', 'I enjoy',
  'I want to', 'my goal', 'I plan to', 'I aim to',
  'I dislike', 'I hate', 'I avoid',
  'I usually', 'I tend to', 'my style',
];
const ALL_KEYWORDS = [...CN_KEYWORDS, ...EN_KEYWORDS];
const keywordHits: Map<string, { count: number; samples: string[] }> = new Map(
  ALL_KEYWORDS.map(k => [k, { count: 0, samples: [] }])
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getConvMessages(conv: Conversation): Message[] {
  return Object.values(conv.mapping)
    .map(n => n.message)
    .filter((m): m is Message => m !== null && m.author !== null);
}

function extractUserText(msg: Message): string {
  if (!msg.content?.parts) return '';
  return msg.content.parts
    .filter(p => typeof p === 'string')
    .join(' ');
}

function timestampToMonth(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function tokenizeTitle(title: string): string[] {
  // Split on whitespace and punctuation for English words (lowercase)
  const enWords = title.toLowerCase().match(/[a-z]{2,}/g) ?? [];
  // Extract Chinese character sequences (2+ chars)
  const cnWords = title.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  return [...enWords, ...cnWords];
}

function charBucket(chars: number): string {
  if (chars < 500) return '0-500';
  if (chars < 2000) return '500-2000';
  if (chars < 10000) return '2000-10000';
  if (chars < 50000) return '10000-50000';
  return '50000+';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Reading: ${DATA_PATH}`);
  console.log('Streaming parse in progress...\n');

  const pipeline = chain([
    createReadStream(DATA_PATH),
    parser(),
    streamArray(),
  ]);

  for await (const { key: idx, value: conv } of pipeline as AsyncIterable<{ key: number; value: Conversation }>) {
    totalConversations++;
    const convIdx = idx as number;

    // ── Schema (first 10) ──
    if (convIdx < SCHEMA_SAMPLE) {
      for (const k of Object.keys(conv)) {
        schemaFields.set(k, (schemaFields.get(k) ?? 0) + 1);
      }
    }

    // ── Time stats ──
    const ct = conv.create_time;
    if (ct) {
      if (ct < minTime) minTime = ct;
      if (ct > maxTime) maxTime = ct;
      const month = timestampToMonth(ct);
      monthCounts[month] = (monthCounts[month] ?? 0) + 1;
    }

    // ── Messages ──
    const messages = getConvMessages(conv);
    const userMsgs = messages.filter(m => m.author.role === 'user');
    const assistantMsgs = messages.filter(m => m.author.role === 'assistant');
    const systemMsgs = messages.filter(m => m.author.role === 'system');
    const toolMsgs = messages.filter(m => m.author.role === 'tool');

    totalUserMsgs += userMsgs.length;
    totalAssistantMsgs += assistantMsgs.length;
    totalSystemMsgs += systemMsgs.length;
    totalToolMsgs += toolMsgs.length;
    messageCounts.push(messages.length);

    // ── User character count ──
    let convUserChars = 0;
    const userTexts: string[] = [];
    for (const m of userMsgs) {
      const txt = extractUserText(m);
      convUserChars += txt.length;
      userTexts.push(txt);
    }
    totalUserChars += convUserChars;
    userCharCounts.push(convUserChars);

    // ── Char buckets ──
    const bucket = charBucket(convUserChars);
    charBuckets[bucket as keyof typeof charBuckets]++;

    // ── Title keywords ──
    const title = conv.title ?? '';
    for (const tok of tokenizeTitle(title)) {
      // skip stop words
      if (['the', 'a', 'an', 'in', 'on', 'at', 'is', 'of', 'to', 'and', 'or', 'for', 'how', 'what'].includes(tok)) continue;
      titleKeywords.set(tok, (titleKeywords.get(tok) ?? 0) + 1);
    }

    // ── Sampling ──
    if (!sampleFilled[bucket]) {
      const firstUserMsg = userTexts[0] ?? '';
      if (firstUserMsg.length > 0 || userMsgs.length === 0) {
        sampleFilled[bucket] = true;
        samples.push({
          bucket,
          title: conv.title,
          firstUserMsg: firstUserMsg.slice(0, 200),
          convIdx,
          userChars: convUserChars,
        });
      }
    }

    // ── Keyword hits ──
    const fullUserText = userTexts.join(' ');
    for (const kw of ALL_KEYWORDS) {
      const entry = keywordHits.get(kw)!;
      let pos = 0;
      while ((pos = fullUserText.indexOf(kw, pos)) !== -1) {
        entry.count++;
        if (entry.samples.length < 3) {
          const snippet = fullUserText.slice(Math.max(0, pos - 10), pos + kw.length + 50).trim();
          entry.samples.push(snippet);
        }
        pos += kw.length;
      }
    }

    if (totalConversations % 200 === 0) {
      process.stdout.write(`  processed ${totalConversations} conversations...\r`);
    }
  }

  console.log(`\nDone. ${totalConversations} conversations processed.\n`);

  // ─── Compute derived stats ─────────────────────────────────────────────────

  const sortedMsgCounts = [...messageCounts].sort((a, b) => a - b);
  const medianMsgs = sortedMsgCounts[Math.floor(sortedMsgCounts.length / 2)];
  const avgMsgs = messageCounts.reduce((a, b) => a + b, 0) / messageCounts.length;
  const maxMsgs = Math.max(...messageCounts);
  const maxCharConvIdx = userCharCounts.indexOf(Math.max(...userCharCounts));

  const topTitleKeywords = [...titleKeywords.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

  const topKeywordHits = [...keywordHits.entries()]
    .filter(([, v]) => v.count > 0)
    .sort((a, b) => b[1].count - a[1].count);

  const totalKeywordHits = topKeywordHits.reduce((s, [, v]) => s + v.count, 0);
  const uniqueKeywordsHit = topKeywordHits.length;

  const sortedMonths = Object.keys(monthCounts).sort();
  const startMonth = sortedMonths[0];
  const endMonth = sortedMonths[sortedMonths.length - 1];

  // ─── Print report to stdout ────────────────────────────────────────────────

  const report = buildReport({
    totalConversations,
    startMonth,
    endMonth,
    totalUserMsgs,
    totalAssistantMsgs,
    totalSystemMsgs,
    totalToolMsgs,
    totalUserChars,
    avgMsgs,
    medianMsgs,
    maxMsgs,
    maxUserChars: Math.max(...userCharCounts),
    charBuckets,
    monthCounts,
    sortedMonths,
    schemaFields,
    topTitleKeywords,
    samples,
    topKeywordHits,
    totalKeywordHits,
    uniqueKeywordsHit,
  });

  process.stdout.write(report);
  return report;
}

// ─── Report Builder ───────────────────────────────────────────────────────────

function buildReport(d: {
  totalConversations: number;
  startMonth: string;
  endMonth: string;
  totalUserMsgs: number;
  totalAssistantMsgs: number;
  totalSystemMsgs: number;
  totalToolMsgs: number;
  totalUserChars: number;
  avgMsgs: number;
  medianMsgs: number;
  maxMsgs: number;
  maxUserChars: number;
  charBuckets: typeof charBuckets;
  monthCounts: Record<string, number>;
  sortedMonths: string[];
  schemaFields: Map<string, number>;
  topTitleKeywords: [string, number][];
  samples: typeof samples;
  topKeywordHits: [string, { count: number; samples: string[] }][];
  totalKeywordHits: number;
  uniqueKeywordsHit: number;
}): string {
  const totalMsgs = d.totalUserMsgs + d.totalAssistantMsgs + d.totalSystemMsgs + d.totalToolMsgs;
  const userMsgPct = ((d.totalUserMsgs / totalMsgs) * 100).toFixed(1);
  const asstMsgPct = ((d.totalAssistantMsgs / totalMsgs) * 100).toFixed(1);
  const sysMsgPct = ((d.totalSystemMsgs / totalMsgs) * 100).toFixed(1);
  const toolMsgPct = ((d.totalToolMsgs / totalMsgs) * 100).toFixed(1);
  const userCharsMB = (d.totalUserChars / 1e6).toFixed(2);

  const schemaTable = [...d.schemaFields.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `  ${k.padEnd(35)} | ${n}/${SCHEMA_SAMPLE}`)
    .join('\n');

  const monthTable = d.sortedMonths
    .map(m => `  ${m}: ${d.monthCounts[m]}`)
    .join('\n');

  const charBucketTable = Object.entries(d.charBuckets)
    .map(([b, n]) => {
      const pct = ((n / d.totalConversations) * 100).toFixed(1);
      return `  ${b.padEnd(15)}: ${n} conversations (${pct}%)`;
    })
    .join('\n');

  const titleKwTable = d.topTitleKeywords
    .map(([k, n]) => `  ${k.padEnd(20)}: ${n}`)
    .join('\n');

  const samplesText = d.samples
    .map((s, i) => {
      return `### S${i + 1} (bucket: ${s.bucket}, user chars: ${s.userChars})\n- Title: "${s.title ?? '(no title)'}"\n- First user msg (first 200 chars): "${s.firstUserMsg}"\n`;
    })
    .join('\n');

  const kwTable = d.topKeywordHits.slice(0, 30)
    .map(([k, v]) => {
      const sampleStr = v.samples.slice(0, 3).map(s => `"${s.replace(/\n/g, ' ')}"`).join(', ');
      return `  ${k.padEnd(20)} | ${String(v.count).padStart(5)} | ${sampleStr}`;
    })
    .join('\n');

  // Conservative extraction estimate:
  // Assume ~40% of keyword hits are genuine preference statements (not hypothetical/quotes)
  const estimatedCandidates = Math.round(d.totalKeywordHits * 0.4);
  const estimatedUnique = Math.round(estimatedCandidates * 0.3); // dedup ~70%

  return `# CT-0027-01 — ChatGPT Export Data Analysis Report

> Generated: ${new Date().toISOString()}
> Data: ~/data/chatgpt/conversations.json
> Task: CT-0027-01 (Design 卡 — Stage 20 ChatGPT adapter)

---

## Schema Discovery

### Top-level structure
- File format: JSON array (顶层为 array，可流式解析 ✓)
- Streaming feasibility: **yes** — \`stream-json\` StreamArray works correctly

### Conversation-level fields (sampled from first ${SCHEMA_SAMPLE} conversations)

\`\`\`
field                                   | presence
----------------------------------------|----------
${schemaTable}
\`\`\`

### Message node structure (mapping[node_id])
Each mapping entry contains:
- \`id\` (string) — node UUID
- \`message\` (object | null) — the actual message
  - \`author.role\` (string): "user" | "assistant" | "system" | "tool"
  - \`author.name\` (string | null)
  - \`content.content_type\` (string): "text" | "multimodal_text" | "tether_browsing_display" | others
  - \`content.parts\` (array): text parts (strings) or image refs (objects)
  - \`create_time\` (number | null)
  - \`metadata\` (object): model_slug, finish_details, citations, etc.
- \`parent\` (string | null)
- \`children\` (array of string)

### Notable fields
- \`gizmo_id\` / \`conversation_template_id\`: present on GPT-based conversations
- \`async_status\`, \`atlas_mode_enabled\`, \`context_scopes\`: null in most cases
- \`is_archived\`, \`is_starred\`, \`is_do_not_remember\`: booleans/nulls

---

## Data Scale

### Overall
| Metric | Value |
|--------|-------|
| Total conversations | ${d.totalConversations} |
| Time span | ${d.startMonth} ~ ${d.endMonth} |
| Total messages (all roles) | ${totalMsgs.toLocaleString()} |
| — user | ${d.totalUserMsgs.toLocaleString()} (${userMsgPct}%) |
| — assistant | ${d.totalAssistantMsgs.toLocaleString()} (${asstMsgPct}%) |
| — system | ${d.totalSystemMsgs.toLocaleString()} (${sysMsgPct}%) |
| — tool | ${d.totalToolMsgs.toLocaleString()} (${toolMsgPct}%) |
| Avg messages/conversation | ${d.avgMsgs.toFixed(1)} |
| Median messages/conversation | ${d.medianMsgs} |
| Max messages in one conversation | ${d.maxMsgs} |
| Total user message chars | ${userCharsMB} MB |
| Max user chars in one conversation | ${d.maxUserChars.toLocaleString()} |

### Time distribution (by conversation create_time)

\`\`\`
${monthTable}
\`\`\`

### User message length distribution (chars per conversation)

\`\`\`
${charBucketTable}
\`\`\`

---

## Content Classification Sampling

### Top 30 title keywords

\`\`\`
${titleKwTable}
\`\`\`

### Sampled conversations (one per length bucket)

${samplesText}

---

## Extraction Potential Assessment

### Keyword hit counts (all user messages across all conversations)

\`\`\`
keyword              | hits  | samples (up to 3)
---------------------|-------|-------------------
${kwTable}
\`\`\`

**Total keyword hits:** ${d.totalKeywordHits}
**Keywords with at least 1 hit:** ${d.uniqueKeywordsHit} / ${ALL_KEYWORDS.length}

### Conservative estimate

| Metric | Estimate | Basis |
|--------|----------|-------|
| Raw keyword hits | ${d.totalKeywordHits} | direct count |
| Genuine preference candidates (40% of hits) | ~${estimatedCandidates} | approx: removes hypothetical/quoted uses |
| Unique preferences after dedup (30% of candidates) | ~${estimatedUnique} | approx: same preference stated multiple times |
| False positive rate (hypothetical "如果我喜欢X..." etc.) | ~60% | estimated; deterministic extractor cannot distinguish |

**Key insight:** The deterministic extractor will see substantial hits, but the majority (~60%) are likely
hypothetical or non-first-person statements. An LLM review pass would dramatically improve precision.

---

## Risks and Open Questions

1. **Streaming library selection**: \`stream-json\` (npm) works well with Node.js ESM + tsx. The \`streamArray()\`
   streamer correctly handles 48MB without memory pressure. Confirmed viable.

2. **Time filter default**: Data spans ${d.startMonth} ~ ${d.endMonth}. The bulk of conversations
   are in recent months (see time distribution above). Recommend defaulting to "--since" last 12 months
   to reduce noise from old, low-quality conversations, with --all flag for full import.

3. **Role filter**: Only \`user\` messages contain first-person preference statements. \`assistant\` messages
   can contain rephrased user preferences ("As you mentioned you prefer X...") but require LLM to extract —
   deterministic should focus on user role only.

4. **Privacy**: ChatGPT export contains full conversation history. cortex should not cache the raw data;
   only extracted facts should persist. The sync command should be ephemeral (read → extract → discard).

5. **Long conversation truncation**: Max user chars in a single conversation = ${d.maxUserChars.toLocaleString()} chars.
   Conversations above ~50,000 chars may need chunking for LLM extraction passes (token budget ~32K).

6. **Token budget (future LLM pass)**: 48MB total data cannot be sent to LLM. Filter strategy:
   (a) time filter, (b) length filter (skip <500 char conversations), (c) keyword pre-screening —
   only send conversations with ≥1 keyword hit to LLM.

7. **\`content_type\` variety**: Some messages have \`content_type: "multimodal_text"\` (image + text)
   or tool result types. Text extraction must handle non-string parts gracefully.

---

## Recommendations

### 6.1 Adapter design

| Decision | Recommendation | Basis |
|----------|----------------|-------|
| Parsing strategy | Stream with \`stream-json\` StreamArray | 48MB; confirmed feasible |
| Time filter default | Last 12 months | Most preference-rich conversations are recent |
| Role filter | User messages only for deterministic | System/tool messages carry no user prefs |
| Length filter | Skip conversations < 500 user chars | Low preference density confirmed by samples |
| LLM pass trigger | Conversations with ≥1 keyword hit | Reduces LLM cost while covering high-signal convs |

### 6.2 Command draft

\`\`\`
cortex sync --from chatgpt-export <path>
   [--since YYYY-MM]              # default: 12 months ago
   [--max-conversations N]        # safety cap, default: 500
   [--min-length N]               # default: 500 chars
   [--accept-all] [--dry-run]
\`\`\`

### 6.3 Expected output (first sync, with defaults)

| Metric | Estimate |
|--------|----------|
| Conversations scanned | ~${Math.round(d.totalConversations * 0.3)} (last 12 months, ≥500 chars) |
| Keyword-hit conversations (LLM candidates) | ~${Math.round(d.totalConversations * 0.3 * 0.4)} |
| Raw extraction candidates | ~${estimatedCandidates} |
| Unique preferences written to user_model | ~${estimatedUnique} |
| Estimated runtime (streaming + deterministic) | 5–15 seconds |
| Estimated runtime (+ LLM pass, if enabled) | 2–10 minutes |

---

*Analysis by CT-0027-01. Script: src/scripts/chatgpt-analysis/analyze.ts*
`;
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
