// Where the app runs:
//  - a normal run (`npm run dev`): a Node server with API routes;
//  - the static demo site (`npm run build:demo`, e.g. GitHub Pages): the demo engine runs in the browser and every
//    URL sits under a base path such as /inkframe.

/** True in the static demo build: the demo engine runs in the browser tab. */
export const STATIC_SITE = process.env.NEXT_PUBLIC_INKFRAME_STATIC === '1';

/** The base path the site is served under ('' locally, '/<repo>' on GitHub Pages). */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** A file from public/, given without a leading slash ('demo/frames'). <Link> adds the base path itself; <img>/<video> don't. */
export const asset = (path: string) => BASE_PATH + '/' + path;

/** The start screen. */
export const HOME_HREF = '/';

/** Where a project's studio lives. Static hosting can't serve /studio/<random id>, so it uses a query string. */
export const studioHref = (id: string) => (STATIC_SITE ? `/studio/?id=${encodeURIComponent(id)}` : `/studio/${id}`);

/** The replay of a project's run ('demo' = the demo run recorded in advance). */
export const replayHref = (id: string) => (STATIC_SITE ? `/replay/?id=${encodeURIComponent(id)}` : `/studio/${id}/replay`);

/** Every project, with its state. */
export const LIBRARY_HREF = '/library';

/** The id of the demo run recorded in advance (lib/engine/demo.ts demoReplay), replayed without a project. */
export const DEMO_REPLAY_ID = 'demo';
