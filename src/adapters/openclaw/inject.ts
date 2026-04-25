import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const BEGIN_MARKER = '<!-- CORTEX_USER_MODEL_BEGIN -->';
const END_MARKER = '<!-- CORTEX_USER_MODEL_END -->';

export async function injectToUserMd(
  userMdPath: string,
  renderedContent: string,
  opts: { dryRun?: boolean } = {}
): Promise<{ inserted: boolean; created: boolean }> {
  let content = '';
  let created = false;

  try {
    content = await fs.readFile(userMdPath, 'utf8');
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      created = true;
    } else {
      throw err;
    }
  }

  const beginIdx = content.indexOf(BEGIN_MARKER);
  const endIdx = content.indexOf(END_MARKER);

  let newContent = content;

  if (beginIdx !== -1 && endIdx !== -1) {
    if (beginIdx > endIdx) {
      console.error('[WARNING] OpenClaw marker mismatch: END marker appears before BEGIN marker. Skipping write.');
      return { inserted: false, created: false };
    }
    // Replace mode
    const before = content.substring(0, beginIdx + BEGIN_MARKER.length);
    const after = content.substring(endIdx);
    if (renderedContent) {
      newContent = `${before}\n${renderedContent}\n${after}`;
    } else {
      newContent = `${before}\n${after}`;
    }
  } else if (beginIdx === -1 && endIdx === -1) {
    // Append mode
    if (renderedContent) {
      const appendStr = `\n${BEGIN_MARKER}\n${renderedContent}\n${END_MARKER}\n`;
      if (content && !content.endsWith('\n')) {
        newContent = content + '\n' + appendStr;
      } else {
        newContent = content + appendStr;
      }
    } else {
      // Nothing to write, do not append empty markers if appending
      return { inserted: false, created: false };
    }
  } else {
    // Mismatch (only one marker)
    console.error('[WARNING] OpenClaw marker mismatch: partial marker found. Skipping write.');
    return { inserted: false, created: false };
  }

  const willInsert = newContent !== content || created;

  if (opts.dryRun) {
    if (willInsert) {
      console.log(`\n--- 注入内容预览 ---`);
      if (renderedContent) {
        console.log(renderedContent);
      } else {
        console.log(`(空)`);
      }
      console.log(`--------------------\n`);
    }
    return { inserted: willInsert, created };
  }

  if (willInsert) {
    const dir = path.dirname(userMdPath);
    await fs.mkdir(dir, { recursive: true });

    // Atomic write
    const tmpName = `${path.basename(userMdPath)}.${Date.now()}.${Math.random().toString(36).substring(2)}.tmp`;
    const tmpPath = path.join(dir, tmpName);

    await fs.writeFile(tmpPath, newContent, 'utf8');
    await fs.rename(tmpPath, userMdPath);
  }

  return { inserted: willInsert, created };
}
