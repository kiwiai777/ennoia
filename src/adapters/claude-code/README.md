# claude-code adapter

This directory contains two distinct capabilities for Claude Code integration:

## 1. Workspace Source Adapter (`index.ts`)

CT-0007. Reads stable files from a Claude Code workspace directory (CLAUDE.md, README.md, root .md files) and returns raw `SourceBlock[]` for downstream extraction/suggestion. This is an *input* adapter — it reads workspace content into Cortex.

Usage:

```bash
cortex import /path/to/workspace --adapter claude-code
```

## 2. Injection Pack Projector (`projector.ts`)

CT-0010. Takes a structured `InjectionPack` (from `buildInjectionPack`) and projects it into Claude Code-specific injection content. This is an *output* adapter — it converts the user model into content suitable for Claude Code consumption.

```
InjectionPack → projectPackForClaudeCode() → ClaudeCodeProjection
```

The projection includes:
- `instruction_text`: ready-to-embed text with XML wrapper, same format as the old text renderer
- `sections`: structured sections per kind (machine-usable, for tooling)
- `entry_count`, `pack_version`, `generated_at`

The CLI routes `--agent claude-code --format text` through this projector:

```bash
cortex inject --agent claude-code        # text, via projector (CT-0010 path)
cortex inject --agent claude-code --format json  # raw structured pack
```

### Relation to old text path

Old path (CT-0008): `UserModel → RuntimeContext/UserSnapshot → renderInjectionForClaudeCode → text`

New path (CT-0010): `UserModel → InjectionPack → projectPackForClaudeCode → ClaudeCodeProjection`

The rendered `instruction_text` output format is equivalent, but the new path directly consumes the structured pack. Generic agent text rendering (`--agent generic`) continues to use the CT-0008 path.

### Not implemented

- Automatic runtime injection / hooks
- Scoped or task-aware selection
- Deep agent runtime integration
