// POST /api/projects/<id>/gate {stage, version, decision: 'approve' | 'revise', note?, scenes?, allowOverCap?} → the state.
//   scenes        revise: [{n, note}] — storyboard: scenes marked «перерисовать»; final: the scene to redo
//   allowOverCap  approve: the human allows an estimate over the budget cap (budget mode `cap`; refused without it)
// 400 = the request is malformed, 404 = no such project, 409 = that version is not waiting (old tab, already sent back)
// or the estimate is over the cap.
import { getEngine } from '@/lib/engine';
import { isGateError } from '@/lib/store/gate';
import { STAGE_IDS, isStageId } from '@/lib/store/types';

export const dynamic = 'force-dynamic';

const bad = (error: string, status: number) => Response.json({ error }, { status });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => undefined) as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object') return bad('Ожидаю JSON: {stage, version, decision, note?}', 400);
  const { stage, version, decision } = body;
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : undefined;
  const scenes = Array.isArray(body.scenes)
    ? body.scenes.flatMap(x => (x && typeof x === 'object' && Number.isInteger((x as { n: unknown }).n) ? [{ n: (x as { n: number }).n, note: String((x as { note?: unknown }).note ?? '').slice(0, 300) }] : [])).slice(0, 12)
    : undefined;
  if (!isStageId(stage)) return bad(`Неизвестный этап: ${JSON.stringify(stage)}. Этапы: ${STAGE_IDS.join(', ')}`, 400);
  if (!Number.isInteger(version) || (version as number) < 1) return bad('version — номер версии этапа (целое число от 1)', 400);
  if (decision !== 'approve' && decision !== 'revise') return bad('decision — "approve" или "revise"', 400);
  if (decision === 'revise' && !note?.trim() && !scenes?.some(x => x.note.trim())) return bad('Напишите замечание — что переделать', 400);
  const engine = getEngine();
  if (!engine.get(id)) return bad('Проект не найден', 404);
  try {
    const state = decision === 'approve'
      ? engine.approve(id, stage, version as number, note, { allowOverCap: body.allowOverCap === true })
      : engine.revise(id, stage, version as number, note ?? '', { scenes });
    return Response.json(state);
  } catch (e) {
    if (isGateError(e)) return bad(e.message, e.status);
    const msg = (e as Error).message;
    return bad(msg, /not found/.test(msg) ? 404 : 500);
  }
}
