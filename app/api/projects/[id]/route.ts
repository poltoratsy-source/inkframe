import { getEngine } from '@/lib/engine';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = getEngine().get((await ctx.params).id);
  return p ? Response.json(p) : Response.json({ error: 'not found' }, { status: 404 });
}
