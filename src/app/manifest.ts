import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Marc OS",
    short_name: "Marc OS",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7f5",
    theme_color: "#1f4e79",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
