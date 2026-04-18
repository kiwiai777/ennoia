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

## Project records

Formal project management documents (spec, decision log, stage archives,
reviews) live in the companion repository:

```
~/projects/ai-project-os/2_projects/cortex/
```

`CLAUDE.md` in this repo is local runtime context only and is not checked in.
