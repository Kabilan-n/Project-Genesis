/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/ws',
    NEXT_PUBLIC_WORLD_ID: process.env.NEXT_PUBLIC_WORLD_ID ?? '',
  },
  webpack(config) {
    // Allow .js imports to resolve to .ts/.tsx files (ESM-style imports in a webpack context)
    config.resolve.extensionAlias = {
      '.js': ['.tsx', '.ts', '.js'],
    };
    return config;
  },
};

module.exports = nextConfig;
