// The stage store of one project, on files (server only):
//   stages/<stage>.json                the newest Checkpoint of a stage
//   stages/history/<stage>.v<N>.json   every version that was replaced — written once, never deleted or overwritten
//   events.jsonl                       the journal, one JSON per line, append-only
// Every write goes through checkCheckpoint, so a gated stage cannot be written `completed` without an approval of
// that very version, whoever calls (engine, API, a script).
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { approveVersion, checkCheckpoint, openVersion, reviseVersion } from './gate';
import { DEFAULT_BUDGET, DEFAULT_CAP_SEC, DEFAULT_GATES, gatesFrom, type BudgetMode, type BudgetPolicy, type Checkpoint, type Decision, type Estimate, type GatePolicy, type LoggedEvent, type SceneNote, type StageId, type StageStatus } from './types';

export class StageStore {
  private cache = new Map<StageId, Checkpoint | null>();
  constructor(readonly dir: string) {}

  private file(stage: StageId) { return join(this.dir, 'stages', `${stage}.json`); }

  get(stage: StageId): Checkpoint | undefined {
    if (!this.cache.has(stage)) {
      let cp: Checkpoint | null = null;
      try { if (existsSync(this.file(stage))) cp = JSON.parse(readFileSync(this.file(stage), 'utf8')); } catch { cp = null; }
      this.cache.set(stage, cp);
    }
    return this.cache.get(stage) ?? undefined;
  }

  /** Validates and writes the newest checkpoint (write to a temp file, then rename: a crash never leaves half a file). */
  put(cp: Checkpoint): Checkpoint {
    checkCheckpoint(cp);
    mkdirSync(join(this.dir, 'stages'), { recursive: true });
    const f = this.file(cp.stage), tmp = `${f}.tmp`;
    writeFileSync(tmp, JSON.stringify(cp, null, 1));
    renameSync(tmp, f);
    this.cache.set(cp.stage, cp);
    return cp;
  }

  /** Changes a stage's status (and resume data) without a new version. */
  set(stage: StageId, status: StageStatus, extra: Partial<Pick<Checkpoint, 'doneScenes' | 'artifact' | 'estimate'>> = {}): Checkpoint {
    const at = new Date().toISOString(), prev = this.get(stage);
    return this.put({ ...(prev ?? { stage, version: 1, startedAt: at }), ...extra, status, updatedAt: at });
  }

  /** A new result of a stage: the previous version (if it was shown) goes to history, the new one waits or completes. */
  open(stage: StageId, artifact: unknown, gated: boolean, estimate?: Estimate): Checkpoint {
    const prev = this.get(stage);
    if (prev && prev.artifact !== undefined) this.archive(prev);
    return this.put(openVersion(prev, stage, artifact, gated, undefined, estimate));
  }

  /** Refuses (409) an estimate over the cap unless `allowOverCap` — whoever calls: API, engine, a script. */
  approve(stage: StageId, version: number, note?: string, allowOverCap = false): { cp: Checkpoint; changed: boolean } {
    const r = approveVersion(this.get(stage), stage, version, note, undefined, allowOverCap);
    if (r.changed) this.put(r.cp);
    return r;
  }

  revise(stage: StageId, version: number, note: string, scenes?: SceneNote[]): Checkpoint {
    return this.put(reviseVersion(this.get(stage), stage, version, note, undefined, scenes));
  }

  /** Versions kept in history for a stage, oldest first. */
  history(stage: StageId): Checkpoint[] {
    const out: Checkpoint[] = [];
    for (let v = 1; existsSync(this.historyFile(stage, v)); v++) out.push(JSON.parse(readFileSync(this.historyFile(stage, v), 'utf8')));
    return out;
  }
  private historyFile(stage: StageId, v: number) { return join(this.dir, 'stages', 'history', `${stage}.v${v}.json`); }
  private archive(cp: Checkpoint) {
    mkdirSync(join(this.dir, 'stages', 'history'), { recursive: true });
    try { writeFileSync(this.historyFile(cp.stage, cp.version), JSON.stringify(cp, null, 1), { flag: 'wx' }); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err; }   // already kept: never overwrite
  }

  /** Appends one line to events.jsonl. */
  log(ev: Omit<LoggedEvent, 'at'>) {
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(join(this.dir, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...ev }) + '\n');
  }
  /** Appends one decision to decisions.jsonl. */
  decide(d: Decision) {
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(join(this.dir, 'decisions.jsonl'), JSON.stringify(d) + '\n');
  }
  decisions(): Decision[] { return readLines<Decision>(join(this.dir, 'decisions.jsonl')); }

  /** estimate.json: the newest estimate, with the fact once the work is over. */
  saveEstimate(e: Estimate) {
    const f = join(this.dir, 'estimate.json'), tmp = `${f}.tmp`;
    writeFileSync(tmp, JSON.stringify(e, null, 1));
    renameSync(tmp, f);
  }
  estimate(): Estimate | undefined {
    try { return JSON.parse(readFileSync(join(this.dir, 'estimate.json'), 'utf8')); } catch { return undefined; }
  }

  events(): LoggedEvent[] {
    return readLines<LoggedEvent>(join(this.dir, 'events.jsonl'));
  }
}

function readLines<T>(f: string): T[] {
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l) as T]; } catch { return []; } });
}

const readConfig = (cwd: string): Record<string, unknown> => {
  const f = join(cwd, 'inkframe.config.json');
  if (!existsSync(f)) return {};
  try { return JSON.parse(readFileSync(f, 'utf8')) ?? {}; }
  catch (err) { console.warn('[inkframe] inkframe.config.json is not valid JSON:', (err as Error).message); return {}; }
};

/** The budget mode: inkframe.config.json {"budget": {"mode": "cap", "capSec": 600}}, then INKFRAME_BUDGET on top
 *  (observe | warn | cap, optionally with seconds: "cap:600"). warn / cap without a number: 15 minutes. */
export function readBudget(cwd = process.cwd(), env: Record<string, string | undefined> = process.env): BudgetPolicy {
  const modes: BudgetMode[] = ['observe', 'warn', 'cap'];
  const b = (readConfig(cwd).budget ?? {}) as Record<string, unknown>;
  let mode: BudgetMode = modes.includes(b.mode as BudgetMode) ? b.mode as BudgetMode : DEFAULT_BUDGET.mode;
  let capSec = typeof b.capSec === 'number' && b.capSec > 0 ? b.capSec : undefined;
  const v = (env.INKFRAME_BUDGET ?? '').trim().toLowerCase();
  if (v) {
    const [m, sec] = v.split(/[:=\s]+/);
    if (modes.includes(m as BudgetMode)) mode = m as BudgetMode;
    if (Number(sec) > 0) capSec = Number(sec);
  }
  return mode === 'observe' ? { mode, ...(capSec && { capSec }) } : { mode, capSec: capSec ?? DEFAULT_CAP_SEC };
}

/** The gate policy of this install: inkframe.config.json {"gates": {"script": true, …}} in the working folder,
 *  then INKFRAME_GATES on top (off | on | a list such as "script,final"). */
export function readGatePolicy(cwd = process.cwd(), env: Record<string, string | undefined> = process.env): GatePolicy {
  const base: GatePolicy = { ...DEFAULT_GATES };
  const g = (readConfig(cwd).gates ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(base) as (keyof GatePolicy)[]) if (typeof g[k] === 'boolean') base[k] = g[k] as boolean;
  return gatesFrom(env.INKFRAME_GATES, base);
}
