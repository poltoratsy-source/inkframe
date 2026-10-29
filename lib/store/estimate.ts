// Estimate: what the rest of a run will cost, before it starts — shown on every gate (EstimateMeter), kept in
// projects/<id>/estimate.json and on the gate's checkpoint, and compared with the fact once the work is over.
//
//   frames      key frames (one per scene, for the contact sheet) + draft frames (sketch + colour, draftFps)
//               + final frames (FINAL_FPS, each scene with its cross-fade overlap)
//   paintSec    ((key + draft) × draft s/frame + final × final s/frame) / workers + painter calls × lead s
//               (a call = the key frames, a scene's sketch, its colour draft, its final clip; the lead is the wait
//               before its first frame: free pages, a page opened at another render scale, the stage loading)
//   voiceSec    voiced lines × s/line
//   cutSec      final frames × encode s/frame + mixing, burning subtitles and the self-review (≈ 0.35 × length + 2 s)
//   diskMb      draft jpgs ≈ 35 KB, final clips ≈ 0.35 MB/s, the MP4 ≈ 0.3 MB/s, final frames waiting for ffmpeg ≈ 90 KB
//
// Pure, so the browser demo shows the same numbers; the server's own speed (SpeedLog) is in lib/real/estimate.ts.
// Fallback speeds: MSK1, SwiftShader, 3 workers painting at once, 29.10.2026 (live M4 run: a draft frame at rs .25 ≈ 1.6 s,
// a final frame at rs .5 ≈ 2.7–5 s of one worker's time — slower than one worker alone, the three share the CPU).
import type { BudgetPolicy, Estimate, StageId } from './types';

/** One worker's seconds per frame, seconds per voiced line, encode seconds per final frame, seconds before a painter
 *  call's first frame. */
export interface Speed { draft: number; final: number; voicePerLine: number; encodePerFrame: number; leadPerCall: number; measured: boolean }
export const FALLBACK_SPEED: Speed = { draft: 1.5, final: 3, voicePerLine: 1, encodePerFrame: .02, leadPerCall: 4, measured: false };

/** What is still ahead for one scene. */
export interface EstimateScene { duration: number; key?: boolean; draft?: boolean; final?: boolean; voice?: boolean }
export interface EstimateInput {
  stage: StageId;
  scenes: EstimateScene[];
  draftFps: number; sketchFrames: number; finalFps: number; overlap: number;
  workers: number;
  speed: Speed;
  claudeMade: number; claudeAhead?: number;
  budget: BudgetPolicy;
  at?: string;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function estimate(i: EstimateInput): Estimate {
  const sp = i.speed, last = i.scenes.length - 1;
  let keyFrames = 0, draftFrames = 0, finalFrames = 0, finalPeak = 0, lines = 0, finalLen = 0, calls = 0;
  for (const [k, sc] of i.scenes.entries()) {
    if (sc.key) keyFrames++;
    if (sc.draft) { draftFrames += i.sketchFrames + Math.max(2, Math.round(sc.duration * i.draftFps)); calls += 2; }
    if (sc.final) {
      const f = Math.round((sc.duration + (k < last ? i.overlap : 0)) * i.finalFps);
      finalFrames += f; finalPeak = Math.max(finalPeak, f); finalLen += sc.duration; calls++;
    }
    if (sc.voice) lines++;
  }
  const cutting = i.scenes.some(sc => sc.final), length = i.scenes.reduce((a, sc) => a + sc.duration, 0);
  const workers = Math.max(1, i.workers);
  if (keyFrames) calls++;   // the key frames are painted all at once
  const paintSec = ((keyFrames + draftFrames) * sp.draft + finalFrames * sp.final) / workers + calls * sp.leadPerCall;
  const voiceSec = lines * sp.voicePerLine;
  const cutSec = cutting ? finalFrames * sp.encodePerFrame + .35 * length + 2 : 0;
  const diskMb = (keyFrames + draftFrames) * .035 + finalLen * .35 + (cutting ? length * .3 + finalPeak * .09 : 0) + lines * .03;
  return {
    stage: i.stage, at: i.at ?? new Date().toISOString(),
    frames: keyFrames + draftFrames + finalFrames, keyFrames, draftFrames, finalFrames,
    secPerFrame: r1(sp.final * 100) / 100, draftSecPerFrame: r1(sp.draft * 100) / 100, measured: sp.measured,
    workers, paintSec: r1(paintSec), voiceSec: r1(voiceSec), cutSec: r1(cutSec), totalSec: r1(paintSec + voiceSec + cutSec),
    claudeCalls: i.claudeMade + (i.claudeAhead ?? 0), diskMb: Math.max(1, Math.round(diskMb)),
    mode: i.budget.mode, ...(i.budget.capSec !== undefined && { capSec: i.budget.capSec }),
  };
}

