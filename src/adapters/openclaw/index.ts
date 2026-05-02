
import { resolveWorkspacePath } from './workspace.js';
import { scanWorkspace } from './scan.js';
import { extract } from '../../core/extraction/index.js';
import type { ExtractionCandidate } from '../../core/extraction/types.js';
import * as path from 'node:path';
import { loadUserModel } from '../../core/user-model/storage.js';
import { renderUserModelToNaturalLanguage } from './render.js';
import { injectToUserMd } from './inject.js';

export async function extractFromOpenClawWorkspace(
  rootPath?: string
): Promise<ExtractionCandidate[]> {
  const actualPath = resolveWorkspacePath(rootPath);
  const blocks = await scanWorkspace(actualPath);

  return extract({
    sourceId: 'openclaw',
    sourceDescriptor: { kind: 'directory', path: actualPath },
    contentBlocks: blocks
  });
}

export async function injectToOpenClaw(
  opts: { workspacePath?: string; dryRun?: boolean } = {}
): Promise<void> {
  const workspacePath = resolveWorkspacePath(opts.workspacePath);
  const userMdPath = path.join(workspacePath, 'USER.md');

  const model = loadUserModel();

  const allItems = [
    ...model.goals.filter(item => (item.status ?? 'active') === 'active').map(g => ({ kind: 'goal', label: g.label })),
    ...model.preferences.filter(item => (item.status ?? 'active') === 'active').map(p => ({ kind: 'preference', label: p.label })),
    ...model.constraints.filter(item => (item.status ?? 'active') === 'active').map(c => ({ kind: 'constraint', label: c.label }))
  ];

  const prefix = opts.dryRun ? 'Cortex → OpenClaw [dry-run]' : 'Cortex → OpenClaw';
  console.log(prefix);
  console.log(`注入路径：${userMdPath}`);

  if (allItems.length === 0) {
    console.log(`\nℹ️  user model 中暂无可注入的偏好 / 目标 / 约束。`);
    console.log(`    先运行 cortex sync 或 cortex reflect 添加内容。`);
    return;
  }

  const renderedContent = renderUserModelToNaturalLanguage(allItems);

  if (!opts.dryRun) {
    console.log(`注入内容：${allItems.length} 条\n`);
  } else {
    console.log(`\n--- 注入内容预览 ---`);
  }
  console.log(renderedContent);
  if (opts.dryRun) {
    console.log(`--------------------\n`);
  } else {
    console.log('');
  }

  const { inserted, created } = await injectToUserMd(userMdPath, renderedContent, opts);

  if (opts.dryRun) {
    console.log(`[dry-run] 未写入。去掉 --dry-run 参数执行实际注入。`);
  } else {
    if (inserted) {
      if (created) {
        console.log(`ℹ️  USER.md 不存在，将创建新文件。`);
        console.log(`✓ 写入完成（新建）。`);
      } else {
        console.log(`✓ 写入完成。`);
      }
      console.log(`ℹ️  请重启 OpenClaw 使更改生效：`);
      console.log(`    systemctl --user restart openclaw-gateway`);
    } else {
      console.log(`ℹ️  无内容变更。`);
    }
  }
}
