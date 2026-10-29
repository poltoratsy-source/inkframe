// Estimate on the server: the formula (lib/store/estimate.ts, shared with the browser demo) fed with this server's own
// speed. Seconds per frame come from its last frames (projects/.speed.json: the median of the last 30 samples of one
// worker's time per frame, per kind); until there are any, the built-in fallbacks.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { FALLBACK_SPEED, type Speed } from '../store/estimate';
export { FALLBACK_SPEED, estimate, type EstimateInput, type EstimateScene, type Speed } from '../store/estimate';

type Kind = 'draft' | 'final' | 'voicePerLine' | 'encodePerFrame' | 'leadPerCall';
const KEEP = 30;

/** projects/.speed.json: the last samples of this server's speed, shared by every project. */
export class SpeedLog {
  private samples: Partial<Record<Kind, number[]>> = {};
  constructor(readonly file: string) {
    try { if (existsSync(file)) this.samples = JSON.parse(readFileSync(file, 'utf8')) ?? {}; } catch { this.samples = {}; }
  }

  /** `sec` of wall time for `count` items done `parallel` at a time → one worker's seconds per item. */
  record(kind: Kind, sec: number, count: number, parallel = 1) {
    if (!(count > 0) || !(sec >= 0)) return;
    const per = sec * Math.max(1, Math.min(parallel, count)) / count;
    const list = [...(this.samples[kind] ?? []), Math.round(per * 1000) / 1000].slice(-KEEP);
    this.samples[kind] = list;
    try { writeFileSync(`${this.file}.tmp`, JSON.stringify(this.samples)); renameSync(`${this.file}.tmp`, this.file); }
    catch { /* the estimate falls back to the built-in speed */ }
  }

  speed(): Speed {
    const med = (k: Kind) => {
      const xs = [...(this.samples[k] ?? [])].sort((a, b) => a - b);
      return xs.length ? xs[Math.floor(xs.length / 2)] : undefined;
    };
    const draft = med('draft'), final = med('final'), voice = med('voicePerLine'), enc = med('encodePerFrame'), lead = med('leadPerCall');
    return {
      // a final frame is never cheaper than a draft one; before the first cut, scale the drafts by the fallback ratio
      draft: draft ?? FALLBACK_SPEED.draft,
      final: final ?? (draft !== undefined ? draft * FALLBACK_SPEED.final / FALLBACK_SPEED.draft : FALLBACK_SPEED.final),
      voicePerLine: voice ?? FALLBACK_SPEED.voicePerLine,
      encodePerFrame: enc ?? FALLBACK_SPEED.encodePerFrame,
      leadPerCall: lead ?? FALLBACK_SPEED.leadPerCall,
      measured: draft !== undefined && final !== undefined,
    };
  }
}
