const fs = require('fs');

let content = fs.readFileSync('src/index.ts', 'utf8');

const regex = /    } else if \(arg === '--with-observation'\) {[\s\S]*?process\.exit\(1\);\n    }\n  }\n\n  \/\/ CT-0019: 如果开启/;

content = content.replace(regex, `    } else if (arg === '--with-observation') {
      withObservation = true;
    } else {
      console.error(\`错误：未知的参数 \${arg}\`);
      process.exit(1);
    }
  }

  if (target === 'openclaw') {
    await injectToOpenClaw({ workspacePath: workspace, dryRun });
    return;
  }

  // CT-0019: 如果开启`);

fs.writeFileSync('src/index.ts', content, 'utf8');
