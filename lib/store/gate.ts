// The rules of a gate, as pure functions on a Checkpoint. The file store (stages.ts) and the browser demo both use
// them, so "approve an old version" or "complete without approval" fails the same way everywhere.
import { STAGE_IDS, STAGE_NAMES, STAGE_STATUSES, overCap, type Checkpoint, type Estimate, type SceneNote, type StageId } from './types';

/** A refused gate call; `status` is the HTTP status the API answers with. */
export class GateError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) { super(message); this.name = 'GateError'; }
}

/** By name, not instanceof: after a dev reload the engine on globalThis may hold an older copy of the class. */
export const isGateError = (e: unknown): e is GateError => e instanceof Error && e.name === 'GateError' && typeof (e as GateError).status === 'number';

const now = () => new Date().toISOString();

/** Throws when a checkpoint is malformed, or claims `completed` on a gate nobody approved. */
export function checkCheckpoint(cp: Checkpoint): Checkpoint {
  if (!STAGE_IDS.includes(cp.stage)) throw new GateError(`Неизвестный этап «${String(cp.stage)}»`, 400);
  if (!STAGE_STATUSES.includes(cp.status)) throw new GateError(`Неизвестное состояние этапа «${String(cp.status)}»`, 400);
  if (!Number.isInteger(cp.version) || cp.version < 1) throw new GateError(`Неверная версия этапа: ${cp.version}`, 400);
  if (cp.gate && cp.status === 'completed' && !(cp.approval?.decision === 'approve' && cp.approval.version === cp.version))
    throw new GateError(`Этап «${STAGE_NAMES[cp.stage]}» v${cp.version} ждёт утверждения — без него его нельзя закрыть`, 409);
  return cp;
}

/** A stage shows a new result. The version goes up only if the previous one was already shown (had an artifact);
 *  the caller keeps the previous checkpoint in history. Gated → awaiting, else completed at once. */
export function openVersion(prev: Checkpoint | undefined, stage: StageId, artifact: unknown, gated: boolean, at = now(), estimate?: Estimate): Checkpoint {
  const version = prev ? (prev.artifact !== undefined ? prev.version + 1 : prev.version) : 1;
  return checkCheckpoint({
    stage, version, artifact, gate: gated, status: gated ? 'awaiting' : 'completed',
    startedAt: prev && prev.artifact === undefined ? prev.startedAt : at, updatedAt: at,
    ...(estimate && { estimate }),
  });
}

const mins = (s: number) => (s < 90 ? `${Math.round(s)} с` : `${Math.round(s / 60)} мин`);

const waiting = (cp: Checkpoint | undefined, stage: StageId, version: number): Checkpoint => {
  if (!cp || !cp.gate) throw new GateError(`Этап «${STAGE_NAMES[stage]}» сейчас не ждёт решения`, 409);
  if (version < cp.version) throw new GateError(`Версия v${version} устарела: сейчас этап «${STAGE_NAMES[stage]}» в версии v${cp.version}. Обновите страницу.`, 409);
  if (version > cp.version) throw new GateError(`Версии v${version} у этапа «${STAGE_NAMES[stage]}» нет: сейчас v${cp.version}`, 409);
  if (cp.status === 'revised') throw new GateError(`Версия v${version} уже возвращена на доработку — дождитесь новой`, 409);
  if (cp.status !== 'awaiting') throw new GateError(`Этап «${STAGE_NAMES[stage]}» v${version} сейчас не ждёт решения`, 409);
  return cp;
};

/** Approves `version`. A second approve of the same version changes nothing (`changed: false`).
 *  Budget mode `cap`: when the estimate on this gate is over the cap, approve needs `allowOverCap` (409 without it). */
export function approveVersion(cp: Checkpoint | undefined, stage: StageId, version: number, note?: string, at = now(), allowOverCap = false): { cp: Checkpoint; changed: boolean } {
  if (cp && cp.version === version && cp.approval?.decision === 'approve' && cp.approval.version === version) return { cp, changed: false };
  const cur = waiting(cp, stage, version), text = note?.trim();
  const over = overCap(cur.estimate);
  if (over && !allowOverCap)
    throw new GateError(`Оценка ≈ ${mins(cur.estimate!.totalSec)} выше лимита ${mins(cur.estimate!.capSec!)}: отметьте «Разрешаю превысить лимит», чтобы утвердить`, 409);
  return {
    cp: checkCheckpoint({ ...cur, status: 'completed', updatedAt: at, approval: { decision: 'approve', version, ...(text && { note: text.slice(0, 500) }), ...(over && { overCap: true }), at } }),
    changed: true,
  };
}

/** Sends `version` back with a note; the stage is `revised` until its next version opens. */
/** `scenes`: scenes marked one by one, each with its own note (storyboard: redraw these; final: redo this scene). */
export function reviseVersion(cp: Checkpoint | undefined, stage: StageId, version: number, note: string, at = now(), scenes?: SceneNote[]): Checkpoint {
  const marks = (scenes ?? []).map(x => ({ n: Math.trunc(Number(x.n)), note: String(x.note ?? '').trim().slice(0, 300) }))
    .filter(x => x.n >= 1 && x.n <= 12 && x.note).slice(0, 12);
  const text = note.trim() || marks.map(x => `Сцена ${x.n}: ${x.note}`).join('; ');
  if (!text) throw new GateError('Напишите замечание — что переделать', 400);
  const cur = waiting(cp, stage, version);
  return checkCheckpoint({ ...cur, status: 'revised', updatedAt: at, approval: { decision: 'revise', version, note: text.slice(0, 500), ...(marks.length && { scenes: marks }), at } });
}
