import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Marc OS",
    short_name: "Marc OS",
    description: "Taken, projecten, klanten, notities en leven op één plek",
    lang: "nl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#16112b",
    theme_color: "#16112b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: [
      { name: "Braindump", url: "/inbox" },
      { name: "Taken vandaag", url: "/taken" },
    ],
  };
}
