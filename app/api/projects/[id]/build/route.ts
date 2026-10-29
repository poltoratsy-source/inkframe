import { getEngine } from '@/lib/engine';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    getEngine().build((await ctx.params).id);
    return Response.json({ ok: true }, { status: 202 });
  } catch (e) {
    const msg = (e as Error).message;
    return Response.json({ error: msg }, { status: /not found/.test(msg) ? 404 : 409 });
  }
}
