import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["ffmpeg-static"],
  experimental: {
    proxyClientMaxBodySize: "2gb",
  },
  turbopack: {
    root: process.cwd(),
  },
  ...(process.env.NODE_ENV === "development"
    ? { assetPrefix: "http://localhost:3006" }
    : {}),
};

export default nextConfig;
