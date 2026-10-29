// A real-engine project's files: draft frames and the finished MP4 (with Range requests, so the player can seek).
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { getEngine } from '@/lib/engine';
import { RealEngine } from '@/lib/engine/real';

export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = { jpg: 'image/jpeg', mp4: 'video/mp4', wav: 'audio/wav', mp3: 'audio/mpeg' };

export async function GET(req: Request, ctx: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path } = await ctx.params;
  const engine = getEngine(), ext = path[path.length - 1]?.split('.').pop() ?? '';
  const file = engine instanceof RealEngine && TYPES[ext] ? engine.fileOf(id, path.join('/')) : undefined;
  if (!file) return Response.json({ error: 'not found' }, { status: 404 });
  const size = statSync(file).size, type = TYPES[ext];
  const head = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': ext === 'jpg' ? 'public, max-age=31536000, immutable' : 'no-cache' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? +range[1] : Math.max(0, size - +range[2]), end = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...head, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}` } });
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { ...head, 'content-length': String(size) } });
}
