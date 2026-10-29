# Inkframe 3 components

All in Inkframe's existing look: dark studio, one warm "pen" accent, Inter 13–14 px, radius 8–12, labels uppercase
12 px (`.label`). Icons: none new — text glyphs as today (▶ ✓ ↺), or Lucide (ISC) if ever needed. Copy is new,
in Russian (the studio's language), with English in the code. Tailwind classes use the @theme names
(`bg-ink-700`, `text-mist-400`, `bg-gate-bg`, `text-danger`…), never raw hex.

StageRail
  what      the production's stages left to right: Бриф · Сценарий · Раскадровка · Отрисовка · Голос · Сборка · Проверка · Финал
  states    pending (mist-500 dot), in_progress (pen dot + .dot-run pulse), awaiting (gate dot + «ждёт вас»),
            completed (ok tick), revised (↺ + version «v2»), failed (danger dot)
  tokens    bg ink-850, item text 12px/600, gap 6, height 40, separators ink-500
  a11y      <ol> with aria-current="step" on the live stage; each item has a text status, not colour only
  used on   studio top (under TopBar), board, replay

GatePanel
  variants  script (the scene list with words and timings), storyboard (ContactSheet), final (MP4 + ReviewReport)
  states    awaiting (gate-bg banner «Этап ждёт вашего решения»), sending, approved (collapses to a tick line),
            sent back (shows the note, stage goes to revised), error (danger line, buttons stay)
  parts     title + version, summary, EstimateMeter, note textarea, buttons «Утвердить» (primary pen) and
            «Вернуть с замечанием» (secondary; disabled until the note has text)
  tokens    bg ink-750, border gate/60 2px, radius xl, padding 16, shadow pop when it slides in
  a11y      role="region" aria-label="Утверждение этапа"; focus moves to the panel when a gate opens;
            Enter in the note does not submit; buttons are real <button>s; the version goes with the request
  used on   studio centre column (over the Stage) while a gate is open

ContactSheet / SceneCard
  what      one card per scene: key frame (draft paint), №, title, the line, start–end, template, edits count
  states    queued (empty frame, mist-500), sketch (.sketchy frame), painting (shimmer + pen line),
            done (frame), awaiting (gate outline), redraw requested (↺ + note)
  tokens    bg ink-700, radius lg, frame radius md, text 12–13, border ink-500, picked: border-pen
  a11y      cards are buttons (pick a scene); the frame has alt = the scene's visual text
  used on   storyboard gate (grid 3–4 columns), board (filmstrip), Timeline (existing, unchanged)

EstimateMeter
  what      «Отрисовка ≈ 3 мин · 180 кадров · 3 потока · Claude 2 запроса · 40 МБ»; after the run «план / факт»
  states    observe (plain), warn (warn text when the estimate is over the threshold), cap (danger + «нужно ваше
            разрешение», blocks «Утвердить» until the box is ticked)
  tokens    bg ink-650, radius md, text 12, numbers 600
  a11y      plain text, the bar is decorative (aria-hidden)
  used on   every gate, board

ReviewReport
  what      self-review of the MP4: probe, duration, black frames, blank frames, silence, clipping, subtitles, slideshow
  states    PASS (ok-bg header «Проверка пройдена»), WARN (warn-bg «Есть замечания»), FAIL (danger-bg «MP4 не отдаём»)
  parts     one row per check: ✓ / ! / ✕, the finding in words, times as chips that seek the video
  tokens    rows 13px, chips pill ink-600
  a11y      a <ul>; the decision is text, not only colour
  used on   final gate, BuildDialog

ActivityFeed
  what      WorkLog lines (exists) fed from events.jsonl; adds «решение» lines (what was chosen and why)
  states    live, replay (lines appear at their recorded time), empty («Пока тихо»)
  used on   left column (WorkLog), board

ReplayScrubber
  what      ▶ / ❚❚, a bar with stage marks, current time «02:14 из 06:40», speed ×1 ×4 ×16
  states    paused, playing, at end
  tokens    bar ink-600, played pen, stage marks mist-400, height 44
  a11y      the bar is a slider (role="slider", arrow keys move 5 s, Home/End); space toggles play
  used on   replay view

LibraryCard
  what      project card in «Недавние» (exists) with a badge
  badges    «рисую» (pen, pulse), «ждёт вас» (gate), «готово» (ok), «ошибка» (danger), «черновик» (mist)
  used on   start screen, library

StylePicker
  what      cards for style packs: preview still, name, one line («Акварель — мягкие заливки на бумаге»,
            «Тушь — чёрная линия на белом, цвет только по делу»)
  states    default, hover, selected (border-pen 2px), unavailable (opacity 40, reason in title)
  a11y      radiogroup; arrows move the choice
  used on   start screen (next to the existing style list)

## Style packs: visual rules (renderer)

Watercolor (today's look, moved into renderer/styles/watercolor)
  paper #F3EBDC, ink #2B2233, palette as PAL in core.js; washes with bleed, hatching allowed, Caveat captions
  boil 12 fps, small amplitude; springs «overshoot» for pops, «settle» for arrivals

Ink (new, renderer/styles/ink)
  white paper #FBFAF7 with light grain, ink #141414, no washes on structure
  colour only by meaning: orange #E8742A = flow / arrows, red #C8372D = the problem, blue #2F6DB5 = the good end
  ≥35 % empty paper, the subject 40–60 % of the frame, one idea per scene
  boil 9–10 fps, larger amplitude on ink lines only, fills hold still
  springs «settle» by default, «bouncy» for landings; Clawd keeps his shape and colour (he is the brand)
