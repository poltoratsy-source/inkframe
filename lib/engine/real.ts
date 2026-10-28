// RealEngine: the place where stage 2 plugs in. It will
//   1. ask Claude (Claude Agent SDK) for a storyboard.json from the idea and settings;
//   2. voice every line with edge-tts and fit scene lengths to the voice;
//   3. have Claude write one painted scene per storyboard entry (p5.js + p5.brush, see
//      github.com/JohnHeibel/ClaudeAnimationBase), render a pencil draft at low resolution, then the colour pass,
//      streaming every frame as a `frame` event;
//   4. redraw a single scene on editScene();
//   5. glue scenes, voice and music with ffmpeg on build().
// It emits exactly the events DemoEngine emits, so the screens stay as they are.
import type { EngineEvent, ProjectState, ProjectSummary, StartSettings, StudioEngine } from './types';

const notYet = () => new Error('The real engine arrives in stage 2. Run with INKFRAME_ENGINE=demo for now.');

export class RealEngine implements StudioEngine {
  readonly mode = 'real' as const;
  create(_settings: StartSettings): ProjectState { throw notYet(); }
  get(_id: string): ProjectState | undefined { return undefined; }
  list(): ProjectSummary[] { return []; }
  subscribe(_id: string, _listener: (ev: EngineEvent) => void): () => void { throw notYet(); }
  editScene(_id: string, _n: number, _request: string): void { throw notYet(); }
  build(_id: string): void { throw notYet(); }
}
