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
