import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
