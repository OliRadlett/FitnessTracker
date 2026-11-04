/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  basePath: '/fittrack',
  // Disable persistent webpack cache in dev — Docker Desktop volume mounts
  // on Windows don't support atomic renames, causing ENOENT errors.
  experimental: {},
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = false;
    }
    return config;
  },
  async rewrites() {
    // In Docker, use the backend service name for SSR requests.
    // Client-side requests use relative URLs (via Caddy proxy).
    const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    return [
      {
        // `basePath: false` keeps the match on the bare `/api/v1` path. With the
        // app's basePath of `/fittrack` the rewrite would otherwise only match
        // `/fittrack/api/v1/...`, so the client's relative `/api/v1/...` calls
        // 404 whenever the app is served without Caddy in front (local
        // `npm run dev` against the compose backend). In production Caddy routes
        // `/api/v1/*` to the backend first, so this rule is not reached.
        source: '/api/v1/:path*',
        destination: `${apiUrl}/api/v1/:path*`,
        basePath: false,
      },
    ];
  },
};

module.exports = nextConfig;
