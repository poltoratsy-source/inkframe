import { getEngine } from '@/lib/engine';
import { DEFAULT_SETTINGS, OPTIONS, STYLES } from '@/lib/options';
import type { StartSettings } from '@/lib/engine/types';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ engine: getEngine().mode, projects: getEngine().list() });
}

/** Keeps only known option values; anything else falls back to the default. */
function clean(body: Partial<StartSettings>): StartSettings {
  const s = { ...DEFAULT_SETTINGS };
  s.idea = String(body.idea ?? '').trim().slice(0, 600);
  const style = STYLES.find(x => x.id === body.style && !x.soon);
  if (style) s.style = style.id;
  for (const k of Object.keys(OPTIONS) as (keyof typeof OPTIONS)[]) {
    const o = (OPTIONS[k] as { value: unknown; soon?: boolean }[]).find(x => x.value === body[k] && !x.soon);
    if (o) (s as unknown as Record<string, unknown>)[k] = o.value;
  }
  return s;
}

export async function POST(req: Request) {
  try {
    const settings = clean(await req.json());
    if (!settings.idea) return Response.json({ error: 'Опиши идею — хотя бы одну фразу' }, { status: 400 });
    const p = getEngine().create(settings);
    return Response.json({ id: p.id }, { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
