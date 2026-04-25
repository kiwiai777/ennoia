import fs from 'node:fs';
import path from 'node:path';
import type { ContentBlock } from '../../core/extraction/types.js';
import { stripCortexMarkers } from './marker.js';

const LIMITS = {
  PER_FILE_MAX_BYTES: 100 * 1024, // 100KB
  TOTAL_MAX_BYTES: 500 * 1024,    // 500KB
};

export async function scanWorkspace(rootPath: string): Promise<ContentBlock[]> {
  if (!fs.existsSync(rootPath)) {
    throw new Error(`Workspace root does not exist: ${rootPath}`);
  }
  const stat = fs.statSync(rootPath);
  if (!stat.isDirectory()) {
    throw new Error(`Workspace root is not a directory: ${rootPath}`);
  }

  const blocks: ContentBlock[] = [];
  let totalBytes = 0;

  const processFile = (fileName: string, hint: 'user-profile' | 'plain', requiresMarkerStrip: boolean) => {
    const fullPath = path.join(rootPath, fileName);
    if (!fs.existsSync(fullPath)) {
      console.warn(`[WARNING] Skipping ${fileName}: file does not exist at ${fullPath}`);
      return;
    }

    const fileStat = fs.statSync(fullPath);
    if (fileStat.size > LIMITS.PER_FILE_MAX_BYTES) {
      console.warn(`[WARNING] Skipping ${fileName}: file size (${fileStat.size} bytes) exceeds limit (${LIMITS.PER_FILE_MAX_BYTES} bytes)`);
      return;
    }

    if (totalBytes + fileStat.size > LIMITS.TOTAL_MAX_BYTES) {
      console.warn(`[WARNING] Skipping ${fileName}: total size limit reached`);
      return;
    }

    totalBytes += fileStat.size;
    let content = fs.readFileSync(fullPath, 'utf8');
    
    if (requiresMarkerStrip) {
      content = stripCortexMarkers(content);
    }

    if (content.trim()) {
      blocks.push({
        path: fileName,
        content,
        kind: 'markdown',
        hint
      });
    }
  };

  processFile('USER.md', 'user-profile', true);
  processFile('SOUL.md', 'plain', false);

  return blocks;
}
