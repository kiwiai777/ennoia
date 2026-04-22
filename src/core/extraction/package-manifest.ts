import type { ContentBlock, ExtractionCandidate, ExtractionInput } from './types.js';

const SKILL_KEYWORDS: Record<string, string> = {
  'typescript': 'TypeScript',
  'react': 'React',
  'vue': 'Vue',
  'python': 'Python',
  'rust': 'Rust',
  'go': 'Go',
  'java': 'Java',
  'node': 'Node.js',
  'next': 'Next.js',
  'express': 'Express',
  'tailwindcss': 'Tailwind CSS',
  'docker': 'Docker',
  'kubernetes': 'Kubernetes',
  'aws-sdk': 'AWS',
  'firebase': 'Firebase',
  'mongodb': 'MongoDB',
  'postgres': 'PostgreSQL',
  'jest': 'Jest',
  'vitest': 'Vitest',
  'webpack': 'Webpack',
  'vite': 'Vite',
  'eslint': 'ESLint',
  'prettier': 'Prettier'
};

export function extractFromPackageManifest(
  block: ContentBlock,
  sourceId: string
): ExtractionCandidate[] {
  const candidates: ExtractionCandidate[] = [];
  const provenance = { source: sourceId, path: block.path };

  try {
    const pkg = JSON.parse(block.content);

    // 1. project name and description
    if (pkg.name) {
      candidates.push({
        kind: 'project',
        content: `Project Name: ${pkg.name}`,
        provenance
      });
    }

    if (pkg.description) {
      candidates.push({
        kind: 'project',
        content: `Project Description: ${pkg.description}`,
        provenance
      });
    }

    // 2. skills from dependencies
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {})
    };

    for (const depName of Object.keys(allDeps)) {
      // 简单匹配常见依赖，如果是已知关键词就提出 skill
      for (const [keyword, skillName] of Object.entries(SKILL_KEYWORDS)) {
        if (depName.includes(keyword)) {
          // Check if already added to avoid duplicates
          if (!candidates.some(c => c.kind === 'skill' && c.content === skillName)) {
             candidates.push({
               kind: 'skill',
               content: skillName,
               provenance
             });
          }
        }
      }
    }

    // 3. engines -> constraint / skill
    if (pkg.engines && pkg.engines.node) {
      candidates.push({
        kind: 'constraint',
        content: `Node.js Version: ${pkg.engines.node}`,
        provenance
      });
    }

  } catch (err) {
    // 忽略解析错误，保持 fail-soft
  }

  return candidates;
}