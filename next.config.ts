import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
  turbopack: {
    root: process.cwd(),
  },
  ...(process.env.NODE_ENV === "development"
    ? { assetPrefix: "http://localhost:3004" }
    : {}),
};

export default nextConfig;
