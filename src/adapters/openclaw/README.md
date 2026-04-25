# OpenClaw Extraction Adapter

Adapter ID: `openclaw`

## 抓取范围 (Phase 1)
- `USER.md`
- `SOUL.md`

## Workspace 路径解析
1. 若用户在 CLI `--workspace` 或 API 中显式指定，则优先使用该路径
2. 否则读取 `~/.openclaw/openclaw.json`，取 `agents.defaults.workspace` 字段
3. 验证该路径存在且为目录

## Round-trip marker 行为
为了避免 cortex 将自身注入的内容再次读取为用户偏好，我们在提取 `USER.md` 时会自动移除 cortex 的专用 marker section:
`<!-- CORTEX_USER_MODEL_BEGIN -->` 至 `<!-- CORTEX_USER_MODEL_END -->`

**注意**：无论内容是谁写入的（即使是用户手动编写），只要被包含在上述 marker 中都会被严格剥除。

## Phase 2 候选项 (Future)
未来阶段可能支持的内容抓取（本阶段不支持）：
- `IDENTITY.md`
- `AGENTS.md`
- `TOOLS.md`
- `skills/`
