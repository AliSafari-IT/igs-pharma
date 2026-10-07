import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Validate env at build time — fail fast before a broken image is deployed
// getEnv() is called lazily; skip at build time if DATABASE_URL not available
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  output: "standalone",

  experimental: {
    ppr: true,
  },

  // Security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },

  images: {
    remotePatterns: [],
  },
};

export default withNextIntl(config);
