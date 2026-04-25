const fs = require('fs');

const pkgStr = fs.readFileSync('package.json', 'utf8');
const pkg = JSON.parse(pkgStr);

// Scheme A: Expand glob pattern to include subdirectories
pkg.scripts.test = "node --import tsx --test \"src/**/__tests__/**/*.test.ts\" \"src/__tests__/**/*.test.ts\"";

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n', 'utf8');
