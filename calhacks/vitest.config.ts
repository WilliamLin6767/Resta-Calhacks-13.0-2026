import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Same "@/..." imports as the app: "@" is the calhacks/ folder.
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // Next.js resolves "server-only" itself; outside Next it's the empty module
      "server-only": fileURLToPath(new URL("./node_modules/next/dist/compiled/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    include: ["lib/**/*.test.ts"],
  },
});
