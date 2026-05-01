import * as fs from 'fs';
import * as path from 'path';

export function resolveExportPath(explicitPath: string): string {
  if (!explicitPath) {
    throw new Error('ChatGPT export path is required. Use --workspace <path>');
  }

  const resolved = path.resolve(explicitPath);

  if (resolved.endsWith('.zip')) {
    throw new Error(
      'ZIP files are not supported. Please unzip the ChatGPT export first and provide the path to the extracted directory or conversations.json file.'
    );
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`Path does not exist: ${resolved}`);
  }

  const stat = fs.statSync(resolved);

  if (stat.isDirectory()) {
    const conversationsPath = path.join(resolved, 'conversations.json');
    if (!fs.existsSync(conversationsPath)) {
      throw new Error(
        `Directory does not contain conversations.json: ${resolved}`
      );
    }
    return conversationsPath;
  }

  if (stat.isFile()) {
    return resolved;
  }

  throw new Error(`Invalid path: ${resolved}`);
}
