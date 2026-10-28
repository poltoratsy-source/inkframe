// One engine per server process, kept on globalThis so Next's dev reloads don't lose running projects.
import { DemoEngine } from './demo';
import { RealEngine } from './real';
import type { StudioEngine } from './types';

const g = globalThis as unknown as { __inkframeEngine?: StudioEngine };

export function getEngine(): StudioEngine {
  if (!g.__inkframeEngine) {
    const speed = Number(process.env.INKFRAME_DEMO_SPEED) || 1;
    g.__inkframeEngine = process.env.INKFRAME_ENGINE === 'real' ? new RealEngine() : new DemoEngine({ speed });
  }
  return g.__inkframeEngine;
}
