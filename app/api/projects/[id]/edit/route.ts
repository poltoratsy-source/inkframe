import { getEngine } from '@/lib/engine';
import { isGateError } from '@/lib/store/gate';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const { scene, request, line, caption } = await req.json();
    const patch = { ...(typeof line === 'string' && { line: line.slice(0, 300) }), ...(typeof caption === 'string' && { caption: caption.slice(0, 120) }) };
    getEngine().editScene(id, Number(scene), String(request ?? ''), Object.keys(patch).length ? patch : undefined);
    return Response.json({ ok: true }, { status: 202 });
  } catch (e) {
    const msg = (e as Error).message;
    return Response.json({ error: msg }, { status: isGateError(e) ? e.status : /not found/.test(msg) ? 404 : 400 });
  }
}
