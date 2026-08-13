import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },

  webpack: (config) => {
    return config;
  },
};

export default nextConfig;
