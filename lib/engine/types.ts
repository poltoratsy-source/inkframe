// The contract between the studio screens and whatever draws the cartoon.
// DemoEngine plays pre-rendered frames on a timer; RealEngine (lib/engine/real.ts) has Claude write the storyboard
// and paints it with the painted renderer. Both emit the same EngineEvents, so the screens never need to know which one runs.
// Inkframe 3: a run goes through stages (lib/store/types.ts); a gated stage stops in `awaiting` until approve() or revise().
import type { Decision, Estimate, LibraryBadge, OpenGate, Review, SceneNote, StageId, StageMap, StageStatus } from '../store/types';
export type { Decision, Estimate, LibraryBadge, OpenGate, Review, SceneNote, StageId, StageMap, StageStatus } from '../store/types';
import type { Replay } from './replay';

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
export interface LogStep {
  id: string; text: string; detail?: string; status: StepStatus;
  /** a «решение: …» line: what was chosen, out of what, and why */
  decision?: Decision;
}

export type SceneStatus = 'queued' | 'sketch' | 'painting' | 'done';
export type FrameKind = 'sketch' | 'color';
/** How an edit changed a scene in the demo: a CSS filter and a zoom. The real engine redraws instead. */
export interface Look { filter: string; zoom: number }

export interface SceneBoard {
  n: number; title: string; visual: string; line: string; start: number; duration: number; caption?: string;
  /** the scene template (real engine: host / object / compare / card) */
  template?: string;
}
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
  /** the key frame of the storyboard gate's contact sheet (a draft of one moment of the scene) */
  key?: string;
}

export interface CurrentFrame { n: number; kind: FrameKind; src: string; index: number; total: number }

/** awaiting = a gate is open: the run stopped and waits for a human decision */
export type ProjectStatus = 'drafting' | 'awaiting' | 'drawing' | 'ready' | 'building' | 'done';

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
  /** every stage with its status and version (projects saved before Inkframe 3 get defaults on load) */
  stages: StageMap;
  /** the gate waiting for a decision, if any */
  gate?: OpenGate;
  /** the self-review of the newest cut; a FAIL comes without `video` */
  review?: Review;
  /** what the work after the open gate will cost; after the work, with the fact (actualSec) */
  estimate?: Estimate;
}

export interface ProjectSummary {
  id: string; title: string; status: ProjectStatus; duration: number; style: StyleId; thumb?: string; createdAt: string;
  /** the stage the project is at (the live one, or the last one done) and its status */
  stage: StageId; stageStatus: StageStatus;
  /** the stage whose gate waits for a human */
  awaiting?: StageId;
  badge: LibraryBadge;
  scenes: number;
}

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
  /** an empty src takes the video away (a scene changed after the cut), and its review with it */
  | { type: 'video'; src: string }
  | { type: 'status'; status: ProjectStatus }
  | { type: 'stage'; stage: StageId; status: StageStatus; version: number }
  | { type: 'gate'; stage: StageId; version: number; open: boolean; summary: string }
  /** the self-review of a fresh cut (comes before its `video`; a FAIL comes without one) */
  | { type: 'review'; review: Review }
  /** a scene's key frame for the storyboard gate; an empty src = it is being redrawn */
  | { type: 'scene.key'; n: number; src: string }
  | { type: 'estimate'; estimate: Estimate }
  /** a choice the engine made (template, voice, fallback…): a «решение» line in WorkLog */
  | { type: 'decision'; decision: Decision };

/** approve(): `allowOverCap` is the human's permission to go over the budget cap (budget mode `cap`). */
export interface ApproveOptions { allowOverCap?: boolean }
/** revise(): scenes marked one by one — storyboard: redraw these; final: redo this scene (the first one). */
export interface ReviseOptions { scenes?: SceneNote[] }

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
  /** Approves `version` of a stage waiting at its gate; the run goes on. Approving the same version again does nothing;
   *  an old version is refused (GateError 409). */
  approve(id: string, stage: StageId, version: number, note?: string, o?: ApproveOptions): ProjectState;
  /** Sends `version` back with a note: the stage is redone (version + 1) and the gate opens again. */
  revise(id: string, stage: StageId, version: number, note: string, o?: ReviseOptions): ProjectState;
  /** The run as timed events for the replay (from events.jsonl, frames from the scene's files); undefined = no such project. */
  replay(id: string): Replay | undefined;
}
