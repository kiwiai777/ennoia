import { test } from 'node:test';
import assert from 'node:assert';
import { stripCortexMarkers } from '../../adapters/openclaw/marker.js';

test('OpenClaw Adapter - stripCortexMarkers', async (t) => {
  await t.test('Normal case - one pair', () => {
    const input = `line1
<!-- CORTEX_USER_MODEL_BEGIN -->
some internal cortex stuff
<!-- CORTEX_USER_MODEL_END -->
line2`;
    const res = stripCortexMarkers(input);
    assert.strictEqual(res, 'line1\nline2');
  });

  await t.test('Multiple pairs', () => {
    const input = `A
<!-- CORTEX_USER_MODEL_BEGIN -->
1
<!-- CORTEX_USER_MODEL_END -->
B
<!-- CORTEX_USER_MODEL_BEGIN -->
2
<!-- CORTEX_USER_MODEL_END -->
C`;
    const res = stripCortexMarkers(input);
    assert.strictEqual(res, 'A\nB\nC');
  });

  await t.test('Missing END marker', () => {
    const input = `A\n<!-- CORTEX_USER_MODEL_BEGIN -->\nB`;
    const res = stripCortexMarkers(input);
    assert.strictEqual(res, input); // no strip
  });

  await t.test('Missing BEGIN marker', () => {
    const input = `A\n<!-- CORTEX_USER_MODEL_END -->\nB`;
    const res = stripCortexMarkers(input);
    assert.strictEqual(res, input); // no strip
  });

  await t.test('Nested markers', () => {
    const input = `A
<!-- CORTEX_USER_MODEL_BEGIN -->
B
<!-- CORTEX_USER_MODEL_BEGIN -->
C
<!-- CORTEX_USER_MODEL_END -->
D
<!-- CORTEX_USER_MODEL_END -->
E`;
    const res = stripCortexMarkers(input);
    assert.strictEqual(res, input); // no strip
  });
});
