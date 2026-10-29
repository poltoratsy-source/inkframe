import type { NextConfig } from 'next';

// `npm run build:demo` sets INKFRAME_STATIC=1: a static site (out/) for GitHub Pages, where the demo engine runs
// in the browser. Otherwise one Node server keeps the engine's state in memory, so there is no static export.
const staticSite = process.env.INKFRAME_STATIC === '1';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // a second studio can run next to the first one (e.g. demo and real) with its own build folder
  ...(process.env.INKFRAME_DIST_DIR && { distDir: process.env.INKFRAME_DIST_DIR }),
  // the real engine drives headless Chrome; keep puppeteer out of the server bundle
  serverExternalPackages: ['puppeteer-core'],
  // No floating Next.js dev badge: the demo is screen-recorded and shown as is.
  devIndicators: false,
  ...(staticSite && {
    output: 'export',
    trailingSlash: true,
    images: { unoptimized: true },
    ...(basePath && { basePath }),
  }),
};

export default nextConfig;
