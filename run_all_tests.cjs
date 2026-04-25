const { spawnSync } = require('child_process');

const r = spawnSync('npm', ['test'], { encoding: 'utf8' });
const fails = r.stdout.split('\n').filter(line => line.includes('# fail '));
if (fails.length > 0 && fails[0].includes('# fail 0') === false) {
    console.log(fails[0]);
    
    // Find all 'not ok' lines
    const lines = r.stdout.split('\n');
    let inError = false;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('not ok')) {
            inError = true;
            console.log(lines[i]);
            for (let j = i+1; j < Math.min(i+15, lines.length); j++) {
                console.log(lines[j]);
                if (lines[j] === '  ...') break;
            }
        }
    }
} else {
    console.log("All tests passed!");
}
