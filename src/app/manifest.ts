import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Marc OS",
    short_name: "Marc OS",
    start_url: "/",
    display: "standalone",
    background_color: "#16112b",
    theme_color: "#16112b",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
