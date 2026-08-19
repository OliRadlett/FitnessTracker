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
        source: '/api/v1/:path*',
        destination: `${apiUrl}/api/v1/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
