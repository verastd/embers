/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The workspace packages ship TypeScript source (no build step), so a fresh
  // clone or a hosted build compiles them here.
  transpilePackages: ['@embers/ui', '@embers/ledger', '@embers/auth'],
  distDir: process.env.EMBERS_DIST_DIR || '.next',
  webpack: (config) => {
    // @embers/ledger and @embers/auth use NodeNext-style `./x.js` specifiers for `./x.ts`.
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

export default nextConfig;
