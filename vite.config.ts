import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    viteTsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart(),
    viteReact(),
  ],
});
