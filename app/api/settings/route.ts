import { join } from 'node:path';
import { getEngine } from '@/lib/engine';
import { hasApiKey, saveApiKey } from '@/lib/settings';

export const dynamic = 'force-dynamic';
const ENV_FILE = join(process.cwd(), '.env.local');
const info = () => ({ hasKey: hasApiKey(ENV_FILE) || !!process.env.ANTHROPIC_API_KEY, engine: getEngine().mode });

// The key itself is never sent back to the browser.
export function GET() { return Response.json(info()); }

export async function POST(req: Request) {
  // Only from this machine: the dev server listens on 127.0.0.1, and Docker maps the port to localhost too.
  try {
    const { apiKey } = await req.json();
    saveApiKey(ENV_FILE, String(apiKey ?? '').trim());
    return Response.json(info());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
