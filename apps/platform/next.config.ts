import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",

  // HTML responses get the full policy (CSP nonce, HSTS, …) from src/proxy.ts (T-011). This only
  // covers what the proxy matcher skips (_next/static, files with an extension).
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [{ key: "X-Content-Type-Options", value: "nosniff" }],
      },
    ];
  },

  images: {
    remotePatterns: [],
  },
};

export default config;
