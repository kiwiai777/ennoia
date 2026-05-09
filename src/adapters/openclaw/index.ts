
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
  console.log(`Injection path: ${userMdPath}`);

  if (allItems.length === 0) {
    console.log(`\nℹ️  No injectable preferences / goals / constraints in user model.`);
    console.log(`    Run cortex sync or cortex reflect to add content first.`);
    return;
  }

  const renderedContent = renderUserModelToNaturalLanguage(allItems);

  if (!opts.dryRun) {
    console.log(`Injection content: ${allItems.length} item(s)\n`);
  } else {
    console.log(`\n--- Injection Preview ---`);
  }
  console.log(renderedContent);
  if (opts.dryRun) {
    console.log(`--------------------\n`);
  } else {
    console.log('');
  }

  const { inserted, created } = await injectToUserMd(userMdPath, renderedContent, opts);

  if (opts.dryRun) {
    console.log(`[dry-run] Not written. Remove --dry-run to perform actual injection.`);
  } else {
    if (inserted) {
      if (created) {
        console.log(`ℹ️  USER.md does not exist, will create new file.`);
        console.log(`✓ Write complete (new file created).`);
      } else {
        console.log(`✓ Write complete.`);
      }
      console.log(`ℹ️  Please restart OpenClaw for changes to take effect:`);
      console.log(`    systemctl --user restart openclaw-gateway`);
    } else {
      console.log(`ℹ️  No content changes.`);
    }
  }
}
