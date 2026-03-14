import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "d33zzd4k5u0xj2.cloudfront.net",
        pathname: "/eu-central-1/workforms-form-logos/**",
      },
    ],
  },
};

export default nextConfig;
