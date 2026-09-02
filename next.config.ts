import type { NextConfig } from "next";

// PostHog ingestion host (region-specific); assets host derives from it.
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
const posthogAssetsHost = posthogHost.replace(".i.posthog.com", "-assets.i.posthog.com");

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "d33zzd4k5u0xj2.cloudfront.net",
        pathname: "/eu-central-1/workforms-form-logos/**",
      },
    ],
  },
  // Reverse proxy for PostHog — events flow through our domain (bypasses ad-blockers).
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: `${posthogAssetsHost}/static/:path*` },
      { source: "/ingest/:path*", destination: `${posthogHost}/:path*` },
    ];
  },
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
