import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Same "@/..." imports as the app: "@" is the calhacks/ folder.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["lib/**/*.test.ts"],
  },
});
