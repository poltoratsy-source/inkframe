import Link from 'next/link';
import { LibraryBadge } from './LibraryBadge';
import { fitIn169, type Badge, type FrameFormat, type StageId } from './types';

export interface LibraryCardView {
  id: string; title: string; href: string; badge: Badge; thumb?: string;
  /** «0:30», «акварель», «Раскадровка ждёт вас» */
  length: string; style: string; stage: StageId; stageText: string;
  /** the cover's format: a vertical or square cover is shown whole inside the 16:9 slot */
  format?: FrameFormat;
}

/** One project in the library and in «Недавние»: cover, badge, length, style, stage. The whole card opens the studio. */
export function LibraryCard({ c, compact = false }: { c: LibraryCardView; compact?: boolean }) {
  const ring = c.badge === 'awaiting' ? 'border-gate/60' : c.badge === 'error' ? 'border-danger/50' : 'border-ink-550';
  return (
    <Link href={c.href} aria-label={`${c.title}: ${c.stageText}`}
      className={`group flex ${compact ? 'items-center gap-2.5 p-2' : 'flex-col gap-2 p-2.5'} rounded-[10px] border ${ring} bg-ink-750 hover:border-pen/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pen`}>
      <div className={`relative flex-none overflow-hidden rounded-md bg-ink-600 ${compact ? 'h-12 w-[84px]' : 'aspect-video w-full'}`}>
        {c.thumb ? <img src={c.thumb} alt="" className={`size-full ${fitIn169(c.format)}`} /> : <div aria-hidden className="flex size-full items-center justify-center text-mist-500">✏</div>}
        {!compact && <span className="absolute left-1.5 top-1.5"><LibraryBadge b={c.badge} /></span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={c.title}>{c.title}</div>
          {compact && <LibraryBadge b={c.badge} />}
        </div>
        <div className="truncate text-[11.5px] text-mist-400">{c.style} · {c.length}{c.format && c.format !== '16:9' && ` · ${c.format}`} · <span className={c.badge === 'awaiting' ? 'text-gate' : c.badge === 'error' ? 'text-danger' : ''}>{c.stageText}</span></div>
      </div>
    </Link>
  );
}

