const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');
content = content.replace(
    "console.log('  cortex inject --target openclaw [--workspace <path>] [--dry-run]\n  cortex inject [--agent <id>] [--format text|json]');",
    "console.log('  cortex inject --target openclaw [--workspace <path>] [--dry-run]');\n  console.log('  cortex inject [--agent <id>] [--format text|json]');"
);
fs.writeFileSync('src/index.ts', content, 'utf8');
