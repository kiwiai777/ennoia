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
npm run dev        # run the entry point via tsx
npm run typecheck  # type-check without emitting
npm run build      # compile to dist/
npm start          # run compiled output
```

## Project records

Formal project management documents (spec, decision log, stage archives,
reviews) live in the companion repository:

```
~/projects/ai-project-os/2_projects/cortex/
```

`CLAUDE.md` in this repo is local runtime context only and is not checked in.
