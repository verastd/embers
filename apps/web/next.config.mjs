/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@embers/ui', '@embers/ledger'],
  distDir: process.env.EMBERS_DIST_DIR || '.next',
};

export default nextConfig;
