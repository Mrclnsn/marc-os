import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Caddy comprimeert al; zo blijft de chat met Hermes (stroom per regel) direct zichtbaar
  compress: false,
  serverExternalPackages: ["node-ical"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
