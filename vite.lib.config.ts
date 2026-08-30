import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist/lib",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: {
        "elur-auth": resolve("src/index.ts"),
        "command": resolve("src/command.ts"),
        "devtools": resolve("src/devtools.ts"),
      },
      name: "ElurJsAuth",
      formats: ["es", "cjs"],
      fileName: (format, entryName) =>
        `${entryName}.${format === "cjs" ? "cjs" : "js"}`,
    },
    rollupOptions: {
      external: ["@elurjs/core", "@elurjs/query"],
      output: {
        preserveModules: false,
        globals: {
          "@elurjs/core": "ElurJs",
        },
      },
    },
  },
});
