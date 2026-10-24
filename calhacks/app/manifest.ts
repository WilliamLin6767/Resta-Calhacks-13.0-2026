import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Back of House",
    short_name: "Back of House",
    description: "Restaurant back-office dashboard",
    start_url: "/chat",
    display: "standalone",
    background_color: "#f9fafb",
    theme_color: "#111827",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
