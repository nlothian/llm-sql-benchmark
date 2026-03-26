import { defineConfig } from "astro/config";
import rehypeMermaid from "rehype-mermaid";
import react from "@astrojs/react";
import mdx from "@astrojs/mdx";
export default defineConfig({
  output: "static",
  integrations: [react(), mdx()],
  markdown: {
    syntaxHighlight: "prism",
    rehypePlugins: [[rehypeMermaid, { strategy: "pre-mermaid" }]]
  },
  vite: {
    esbuild: {
      jsx: "automatic",
      jsxImportSource: "react"
    },
    optimizeDeps: {
      include: ["mermaid"]
    }
  }
});
