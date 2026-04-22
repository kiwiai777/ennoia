const fs = require('fs');
let code = fs.readFileSync('src/core/extraction/markdown.ts', 'utf8');

// replace agent-def heuristic
const oldHeuristic = `    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('# Role') || trimmed.toLowerCase().includes('you are a')) {
        candidates.push({
          kind: 'preference',
          content: trimmed.replace(/^#+ /, '').trim(),
          provenance
        });
      } else if (trimmed.startsWith('- Never') || trimmed.startsWith('- Always')) {`;

const newHeuristic = `    let inRole = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '# Role') {
        inRole = true;
        continue;
      }
      if (inRole && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
        candidates.push({
          kind: 'preference',
          content: trimmed,
          provenance
        });
      } else if (trimmed.startsWith('- Never') || trimmed.startsWith('- Always')) {`;

code = code.replace(oldHeuristic, newHeuristic);
fs.writeFileSync('src/core/extraction/markdown.ts', code);
