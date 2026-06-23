/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // `postgres` is a server-only dependency — keep it out of the client bundle.
    serverComponentsExternalPackages: ["postgres"],
  },
  // Type errors still fail the build (tsc runs); lint is advisory so style nits
  // don't block deploys.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
