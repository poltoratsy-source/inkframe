// The contract between the studio screens and whatever draws the cartoon.
// DemoEngine plays pre-rendered frames on a timer; RealEngine (lib/engine/real.ts) has Claude write the storyboard
// and paints it with the painted renderer. Both emit the same EngineEvents, so the screens never need to know which one runs.

export type StyleId = 'watercolor' | 'kinetic' | 'reels' | 'promo' | 'science' | 'board' | 'clip';

export interface StartSettings {
  idea: string;
  style: StyleId;
  /** seconds */
  duration: number;
  format: '16:9' | '9:16' | '1:1';
  voice: 'svetlana' | 'dmitry' | 'duo' | 'none';
  hero: 'claude' | 'photo' | 'none';
  audience: 'kids' | 'school' | 'adults' | 'clients';
  music: 'calm' | 'upbeat' | 'own' | 'none';
  language: 'ru' | 'en' | 'kk';
  ending: 'codeword' | 'subscribe' | 'none';
}

export type StepStatus = 'ok' | 'run' | 'wait' | 'err';
export interface LogStep { id: string; text: string; detail?: string; status: StepStatus }

export type SceneStatus = 'queued' | 'sketch' | 'painting' | 'done';
export type FrameKind = 'sketch' | 'color';
/** How an edit changed a scene in the demo: a CSS filter and a zoom. The real engine redraws instead. */
export interface Look { filter: string; zoom: number }

export interface SceneBoard { n: number; title: string; visual: string; line: string; start: number; duration: number; caption?: string }
/** A direct change to a scene's words, made in the edit panel (the real engine redraws only that scene). */
export interface ScenePatch { line?: string; caption?: string }
export interface Scene extends SceneBoard {
  status: SceneStatus;
  frame?: string;
  frameKind?: FrameKind;
  /** colour frames drawn so far, in order (the studio plays them back as a preview) */
  colors: string[];
  look: Look;
  edited: boolean;
  version: number;
  edits: string[];
}

export interface CurrentFrame { n: number; kind: FrameKind; src: string; index: number; total: number }

export type ProjectStatus = 'drafting' | 'drawing' | 'ready' | 'building' | 'done';

export interface ProjectState {
  id: string;
  engine: 'demo' | 'real';
  createdAt: string;
  title: string;
  settings: StartSettings;
  status: ProjectStatus;
  scenes: Scene[];
  log: LogStep[];
  /** 0..1 for the whole cartoon */
  progress: number;
  etaSec: number;
  current?: CurrentFrame;
  tracks: { voice?: number[]; music?: number[] };
  video?: string;
}

export interface ProjectSummary { id: string; title: string; status: ProjectStatus; duration: number; style: StyleId; thumb?: string; createdAt: string }

export type EngineEvent =
  | { type: 'snapshot'; state: ProjectState }
  | { type: 'log.add'; step: LogStep }
  | { type: 'log.update'; id: string; status: StepStatus; text?: string; detail?: string }
  | { type: 'storyboard'; title: string; scenes: SceneBoard[] }
  | { type: 'scene.status'; n: number; status: SceneStatus }
  | ({ type: 'frame' } & CurrentFrame)
  | { type: 'scene.look'; n: number; look: Look }
  | { type: 'scene.edited'; n: number; request: string }
  | { type: 'scene.board'; n: number; patch: Partial<Omit<SceneBoard, 'n'>> }
  | { type: 'progress'; value: number; etaSec: number }
  | { type: 'track'; kind: 'voice' | 'music'; peaks: number[] }
  /** an empty src takes the video away (a scene changed after the cut) */
  | { type: 'video'; src: string }
  | { type: 'status'; status: ProjectStatus };

/** An event scheduled `at` milliseconds after its script starts. */
export interface TimedEvent { at: number; ev: EngineEvent }

export interface StudioEngine {
  readonly mode: 'demo' | 'real';
  /** Starts a new cartoon; returns its initial state at once and keeps working in the background. */
  create(settings: StartSettings): ProjectState;
  get(id: string): ProjectState | undefined;
  list(): ProjectSummary[];
  /** The listener first receives a `snapshot`, then every event. Returns an unsubscribe function. */
  subscribe(id: string, listener: (ev: EngineEvent) => void): () => void;
  /** Redraw one scene from a text request (and/or new words); other scenes stay as they are. */
  editScene(id: string, n: number, request: string, patch?: ScenePatch): void;
  /** Glue the finished scenes and sound into an MP4. */
  build(id: string): void;
}
