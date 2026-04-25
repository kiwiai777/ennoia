import { resolveWorkspacePath } from './workspace.js';
import { scanWorkspace } from './scan.js';
import { extract } from '../../core/extraction/index.js';
import type { ExtractionCandidate } from '../../core/extraction/types.js';

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
