import { defineConfig } from 'vite';

// Base './' makes the production build work when opened from any path.
export default defineConfig({
  base: './',
  server: { open: true },
  // @pixiv/three-vrm must share the app's single THREE instance.
  resolve: { dedupe: ['three'] },
});
