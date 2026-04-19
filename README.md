# Cortex

User model layer across AI systems.

## Status

Stage 0 — Initialization

## Goal

Build a persistent user model that influences AI behavior across tools.

Cortex is not a memory DB or RAG layer. It aims to maintain a structured,
versioned representation of the user (projects, goals, preferences,
constraints, skills, states, decision rules) and feed it back into AI
systems to influence prompt construction, planning, and tool selection.

## Layout

```
src/
  index.ts              minimal entry point
  core/
    user-model/         user model schema and storage
    memory/             raw memory events
    runtime/            runtime context assembly
  ingestion/            transcript / event ingestion
  extraction/           structured candidate extraction
  adapters/             per-agent adapters (e.g. Claude Code)
scripts/                one-off operational scripts
```

## Requirements

- Node.js 20+
- npm 10+

## Usage

```bash
npm install
npm run typecheck  # type-check without emitting
npm run build      # compile to dist/
```

### CLI

The `cortex` CLI is exposed via `bin/cortex`. You can invoke it directly or
run `npm link` in this directory to put `cortex` on your PATH.

```bash
./bin/cortex save "我在做 Cortex 项目"
./bin/cortex save "避免单点依赖"
./bin/cortex context
```

Expected output for `cortex context`:

```text
[User Context]

项目：
  （暂无）

目标：
  - 我在做 Cortex 项目
  - 避免单点依赖

偏好：
  （暂无）

约束：
  （暂无）

决策规则：
  （暂无）
```

User model data is stored at `~/.cortex/user_model.json`. The file is
created on first use. Edit it directly if you want to adjust fields
outside of `save`.

### Inject (text vs structured)

`cortex inject` produces an agent-facing payload from the user model.
It supports two output formats:

```bash
./bin/cortex inject                                     # default: text
./bin/cortex inject --agent claude-code                 # text, agent-tuned
./bin/cortex inject --format text                       # explicit text
./bin/cortex inject --format json                       # structured pack (JSON)
./bin/cortex inject --agent claude-code --format json   # both flags
```

- `--format text` (default) returns the rendered instruction string from
  CT-0008. Stable for prompt concatenation and human inspection. Behavior
  is unchanged from prior versions.
- `--format json` returns a Structured Injection Pack v0.1 — a stable
  JSON object that adapters / scripts can consume directly without
  re-parsing the rendered text.

This is **not** a runtime auto-injection mechanism. Cortex does not
attach itself to any agent process; it only produces a payload you (or
an adapter) decide what to do with.

#### Structured Injection Pack v0.1

Top-level shape:

```text
version              "0.1"
generated_at         ISO-8601 timestamp
source               { generator, generator_version, user_model_schema_version,
                       agent, selection_strategy }
user_summary         { total_entries, counts: { <kind>: number } }
entries              authoritative list of confirmed user-model items
projects | goals | preferences | constraints | skills | states | decision_rules
                     derived per-kind views over `entries`
open_questions       reserved for future scoped/task-aware selection (always [])
instructions         { text, notes[] } — restrained guidance for downstream agents
```

Each `entries` item carries:

```text
id, kind, content, provenance, confirmed, created_at, updated_at, details?
```

`details` only contains fields meaningful to the entry's `kind` (e.g.
`when`/`then` for `decision_rule`, `level` for `skill`). Empty user-model
categories produce empty arrays — never missing fields or `null`.

The pack reflects the current confirmed user model only. It is not a
ranking, not a scoped selection, and does not claim relevance to the
caller's current task.

## Project records

Formal project management documents (spec, decision log, stage archives,
reviews) live in the companion repository:

```
~/projects/ai-project-os/2_projects/cortex/
```

`CLAUDE.md` in this repo is local runtime context only and is not checked in.
