import { defineConfig } from 'vite'
import glsl from 'vite-plugin-glsl'

// Relative base so the site works from the GitHub Pages subfolder.
// The build goes to docs/ so Pages can serve it straight from this branch.
export default defineConfig({
  base: './',
  plugins: [glsl()],
  build: {
    outDir: 'docs',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
})
