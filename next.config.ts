import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The demo engine keeps its state in memory: one server process, no static export.
  poweredByHeader: false,
};

export default nextConfig;
