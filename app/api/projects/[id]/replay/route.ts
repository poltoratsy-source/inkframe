// GET /api/projects/<id>/replay → the run as timed events (Replay: startedAt, events, marks, the start state) folded
// from events.jsonl; frames come from the scenes' own files. 404 = no such project; a project without a journal
// (made before Inkframe 3) answers 200 with journal "none" and no events.
import { getEngine } from '@/lib/engine';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = getEngine().replay((await ctx.params).id);
  return r ? Response.json(r) : Response.json({ error: 'Проект не найден' }, { status: 404 });
}
