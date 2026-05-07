// Generic File/Directory Sync Adapter (CT-0033-01)
//
// Supports extracting content from arbitrary files and directories:
// - Text files: .md, .txt, .json
// - PDF files: .pdf
// - Word documents: .docx, .doc
//
// Usage: cortex sync --from file --path <file-or-dir>

import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import type { ContentBlock } from '../../core/extraction/types.js';

export interface FileAdapterOptions {
  path: string;
  extensions?: string[];  // default: ['.md', '.txt', '.json', '.pdf', '.docx', '.doc']
  maxDepth?: number;      // default: 10
}

async function readTextFile(filePath: string): Promise<string> {
  return fs.readFileSync(filePath, 'utf-8');
}

async function readPdfFile(filePath: string): Promise<string> {
  const dataBuffer = fs.readFileSync(filePath);
  const parser = new PDFParse(dataBuffer);
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
}

async function readDocxFile(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

async function readDocFile(filePath: string): Promise<string> {
  // .doc format (old Word binary format) is complex and requires additional libraries
  // For MVP, provide clear error message
  throw new Error('.doc format not yet supported. Please convert to .docx or save as .txt');
}

async function readFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.md':
    case '.txt':
    case '.json':
      return readTextFile(filePath);
    case '.pdf':
      return readPdfFile(filePath);
    case '.docx':
      return readDocxFile(filePath);
    case '.doc':
      return readDocFile(filePath);
    default:
      throw new Error(`Unsupported file format: ${ext}. Supported: .md, .txt, .json, .pdf, .docx`);
  }
}

export async function extractFromFile(options: FileAdapterOptions): Promise<ContentBlock[]> {
  const {
    path: targetPath,
    extensions = ['.md', '.txt', '.json', '.pdf', '.docx', '.doc'],
    maxDepth = 10
  } = options;

  // Check if path exists
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Path does not exist: ${targetPath}`);
  }

  const stat = fs.statSync(targetPath);
  const files: string[] = [];

  if (stat.isFile()) {
    // Single file
    files.push(targetPath);
  } else if (stat.isDirectory()) {
    // Directory: find matching files
    const patterns = extensions.map(ext => `**/*${ext}`);
    for (const pattern of patterns) {
      const matches = await glob(pattern, {
        cwd: targetPath,
        absolute: true,
        maxDepth,
        nodir: true,
      });
      files.push(...matches);
    }
  } else {
    throw new Error(`Path is neither file nor directory: ${targetPath}`);
  }

  if (files.length === 0) {
    console.warn(`Warning: No supported files found in ${targetPath}`);
    return [];
  }

  // Read files and create ContentBlocks
  const blocks: ContentBlock[] = [];
  for (const file of files) {
    try {
      const content = await readFile(file);
      if (content.trim().length === 0) {
        console.warn(`Warning: ${file} is empty, skipping`);
        continue;
      }

      blocks.push({
        path: file,
        content: content.trim(),
        kind: 'plain',
        hint: 'plain',
      });
    } catch (err) {
      console.warn(`Warning: Failed to read ${file}: ${err instanceof Error ? err.message : String(err)}`);
      // Continue with other files
    }
  }

  return blocks;
}
