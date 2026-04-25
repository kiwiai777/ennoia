import { injectToOpenClaw } from './openclaw/index.js';

export type InjectTarget = 'openclaw';

export const ALL_INJECT_TARGETS: readonly InjectTarget[] = ['openclaw'];

export async function injectToTarget(
  target: InjectTarget,
  opts: { workspacePath?: string; dryRun?: boolean }
): Promise<void> {
  switch (target) {
    case 'openclaw':
      return injectToOpenClaw(opts);
    default: {
      const _exhaustive: never = target;
      throw new Error(`Unknown inject target: ${_exhaustive}`);
    }
  }
}
