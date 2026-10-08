import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  redirects: () => [{ source: "/recurring", destination: "/plan?view=recurring", permanent: true }],
};

export default nextConfig;
