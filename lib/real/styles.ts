// Style packs on the server: the files themselves (renderer/styles/<id>/), read from disk — the same files the stage
// page loads — so a pack edited by hand is checked here before a cartoon is painted with it.
//   style.json   the pack (lib/styles.ts says what is in it; checkPack checks it)
//   STYLE.md     rules for the storyboard: what to draw in this style and how; it goes into Claude's prompt
//   kit.js       the pack's own drawing helpers (Ink: its line-hint backgrounds), loaded by the stage page
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { STYLE_IDS, checkPack, styleOf, type StyleId, type StylePack } from '../styles';

const DIR = () => resolve('renderer/styles');

/** The pack as it is on disk; throws with every problem found. */
export function loadPack(id: StyleId, dir = DIR()): StylePack {
  const file = join(dir, id, 'style.json');
  if (!existsSync(file)) throw new Error(`no style pack ${id} (${file})`);
  const pack = JSON.parse(readFileSync(file, 'utf8')), bad = checkPack(pack, id);
  if (pack.kit && !existsSync(join(dir, id, pack.kit))) bad.push(`kit ${pack.kit} is missing`);
  if (bad.length) throw new Error(`style pack ${id}: ${bad.join('; ')}`);
  return pack as StylePack;
}

/** Every pack on disk with its problems (an empty list = fine). */
export function checkPacks(dir = DIR()): Record<StyleId, string[]> {
  return Object.fromEntries(STYLE_IDS.map(id => {
    try { loadPack(id, dir); return [id, []]; } catch (e) { return [id, [(e as Error).message]]; }
  })) as Record<StyleId, string[]>;
}

/** STYLE.md of the pack (rules for the storyboard prompt); empty when the pack has none. */
export function styleNotes(v: unknown, dir = DIR()): string {
  const file = join(dir, styleOf(v), 'STYLE.md');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}
