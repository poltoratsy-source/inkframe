// GET /api/projects/<id>/review → the self-review of the newest cut (Review), 404 = no such project or no cut checked yet.
import { getEngine } from '@/lib/engine';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = getEngine().get((await ctx.params).id);
  if (!p) return Response.json({ error: 'Проект не найден' }, { status: 404 });
  return p.review ? Response.json(p.review) : Response.json({ error: 'Ролик ещё не проверяли: сначала соберите MP4' }, { status: 404 });
}
