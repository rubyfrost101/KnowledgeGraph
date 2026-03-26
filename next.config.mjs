/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizePackageImports: ['d3-force'],
  },
};

export default nextConfig;
