// Server-sent events: a snapshot of the project, then every engine event as it happens.
import { getEngine } from '@/lib/engine';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const engine = getEngine();
  if (!engine.get(id)) return Response.json({ error: 'not found' }, { status: 404 });
  const enc = new TextEncoder();
  let off = () => {}, ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => { try { controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { off(); } };
      off = engine.subscribe(id, send);
      ping = setInterval(() => { try { controller.enqueue(enc.encode(': ping\n\n')); } catch { /* closed */ } }, 15000);
      req.signal.addEventListener('abort', () => { off(); clearInterval(ping); try { controller.close(); } catch { /* closed */ } });
    },
    cancel() { off(); clearInterval(ping); },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' } });
}
