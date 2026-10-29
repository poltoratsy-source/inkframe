# Skills: painted-animation and kinetic-reel

Inkframe is a studio around one idea: Claude storyboards a film, paints every frame in code and checks the result by eye.
The same method works without Inkframe, as two Claude Code skills. They are bundled here from
[tuzhechen2005/opus-video-skills](https://github.com/tuzhechen2005/opus-video-skills) (commit `59744a6`, MIT) unchanged,
except that links to the collection README now point to the original repository.

| Skill | What it makes |
|---|---|
| [`painted-animation`](painted-animation/) | Hand-painted watercolour-and-ink cartoons, music and lyric videos: p5.js + p5.brush, headless Chrome, ffmpeg. Inkframe's painter grew out of its engine. |
| [`kinetic-reel`](kinetic-reel/) | Kinetic-typography motion reels: showreels, product promos, intros. Canvas 2D + three.js layers and a synthesized, beat-locked score. |

## Use them on their own

1. Copy the folders into your Claude Code skills:
   ```bash
   mkdir -p ~/.claude/skills
   cp -r skills/painted-animation skills/kinetic-reel ~/.claude/skills/
   ```
   Or install the original collection as a plugin: `/plugin marketplace add tuzhechen2005/opus-video-skills`.
2. Have Node.js, Chrome (or Chromium) and ffmpeg on the machine. On a server without a GPU, Chrome paints in software: slower, but it works.
3. Ask Claude Code in plain words, for example *"make a 60-second hand-painted cartoon about how a neural network learns"* or
   *"make a 20-second kinetic-type promo for my app"*. The skill switches on by itself, writes a storyboard, renders contact
   sheets, fixes what it sees and hands you an MP4.

Each skill folder has its own README (English and Chinese), a `SKILL.md` with the full method, a starter template and worked examples.

## Licence and credits

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 tuzhechen2005. The animation engine and guide in
`painted-animation/template/` and the renderer in `kinetic-reel/template/render.mjs` derive from
[ClaudeAnimationBase](https://github.com/JohnHeibel/ClaudeAnimationBase) by John Heibel (MIT, see
`painted-animation/template/LICENSE`); the method comes from his [PDoomVideo](https://github.com/JohnHeibel/PDoomVideo).

---

## По-русски

Тот же метод, на котором рисует Inkframe, можно использовать без студии, как два скилла Claude Code.
Они взяты из [tuzhechen2005/opus-video-skills](https://github.com/tuzhechen2005/opus-video-skills) (MIT) без изменений,
поправлены только ссылки на общий README сборника.

- **painted-animation** — рисованные акварелью мультфильмы и клипы с караоке-субтитрами. Из его движка вырос отрисовщик Inkframe.
- **kinetic-reel** — ролики на кинетической типографике: шоурилы, промо, заставки, с музыкой, собранной в коде.

Как поставить: скопируй папки `skills/painted-animation` и `skills/kinetic-reel` в `~/.claude/skills/`. Нужны Node.js, Chrome и ffmpeg.
Дальше попроси Claude Code обычными словами, например: «сделай рисованный мультфильм на минуту о том, как учится нейросеть».
Скилл включится сам, напишет раскадровку, проверит кадры и соберёт MP4.
