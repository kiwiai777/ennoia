const fs = require('fs');

let content = fs.readFileSync('src/index.ts', 'utf8');

const regex = /    } else if \(arg === '--with-observation'\) {[\s\S]*?process\.exit\(1\);\n    }\n  }\n\n  const context = selectRuntimeContext\(model, {/;

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

  const context = selectRuntimeContext(model, {`);

fs.writeFileSync('src/index.ts', content, 'utf8');
