import { defineConfig } from 'vite'

// Browser bundle config — mirrors a vanilla SvelteKit/Vite consumer's build
// path (the same path that crashed in Heroes for D1). No SSR, no library
// mode, no externals overrides. The test asserts the produced bundle is
// clean of node:crypto / google-auth-library symbols.
export default defineConfig({
  build: {
    // Default outDir is `dist`; the test cleans and re-creates it per run.
    minify: false, // readable assets so substring asserts are robust to mangling
    target: 'es2022',
  },
})
