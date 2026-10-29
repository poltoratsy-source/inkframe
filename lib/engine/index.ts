// One engine per server process, kept on globalThis so Next's dev reloads don't lose running projects.
import { DemoEngine } from './demo';
import { RealEngine } from './real';
import { readGatePolicy } from '../store/stages';
import type { StudioEngine } from './types';

const g = globalThis as unknown as { __inkframeEngine?: StudioEngine };

export function getEngine(): StudioEngine {
  // an engine made by code from before Inkframe 3 can survive a dev reload; it knows no gates, so make a new one
  if (!g.__inkframeEngine || typeof g.__inkframeEngine.approve !== 'function') {
    const speed = Number(process.env.INKFRAME_DEMO_SPEED) || 1;
    const gates = readGatePolicy();   // inkframe.config.json + INKFRAME_GATES, the same for both engines
    g.__inkframeEngine = process.env.INKFRAME_ENGINE === 'real' ? new RealEngine({ gates }) : new DemoEngine({ speed, gates });
  }
  return g.__inkframeEngine;
}
