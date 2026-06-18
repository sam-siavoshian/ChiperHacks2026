/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // force-graph sim + rAF drains do not want double-mount in dev
  transpilePackages: ["@lobehub/icons"], // ESM-only brand-logo set, needs Next transpile
};

export default nextConfig;
