import { getEngine } from '@/lib/engine';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const { scene, request } = await req.json();
    getEngine().editScene(id, Number(scene), String(request ?? ''));
    return Response.json({ ok: true }, { status: 202 });
  } catch (e) {
    const msg = (e as Error).message;
    return Response.json({ error: msg }, { status: /not found/.test(msg) ? 404 : 400 });
  }
}
