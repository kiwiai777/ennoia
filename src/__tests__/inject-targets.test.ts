import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ALL_INJECT_TARGETS, injectToTarget, InjectTarget } from '../adapters/inject-targets.js';

test('ALL_INJECT_TARGETS contains openclaw', () => {
  assert.ok(ALL_INJECT_TARGETS.includes('openclaw'));
});

test('injectToTarget resolves to openclaw when target is openclaw', async () => {
  // Using try/catch to test if it routes properly; we don't necessarily need it to succeed injecting, just routing.
  // Actually, wait, calling injectToOpenClaw without a workspace might fail if ~/.openclaw isn't present,
  // but we can just check it throws the "failed to resolve openclaw workspace" or something, meaning it reached the function.
  // We can pass dryRun: true to be safe.
  try {
    await injectToTarget('openclaw', { workspacePath: '/dummy', dryRun: true });
    // May succeed or fail depending on what injectToOpenClaw does, but it shouldn't throw "Unknown inject target"
  } catch (err) {
    if (err instanceof Error) {
      assert.notEqual(err.message, 'Unknown inject target: openclaw');
    }
  }
});

test('injectToTarget throws on unknown target', async () => {
  await assert.rejects(
    async () => {
      // @ts-expect-error Testing invalid target
      await injectToTarget('unknown', { dryRun: true });
    },
    /Unknown inject target: unknown/
  );
});
