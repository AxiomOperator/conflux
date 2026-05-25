import type { NextConfig } from "next";

const internalApiUrl = process.env.INTERNAL_API_URL ?? "http://localhost:8001";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["postgres"],
  allowedDevOrigins: ["conflux.fbcad.org"],
  async rewrites() {
    return [
      {
        source: "/v1/:path*",
        destination: `${internalApiUrl}/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
