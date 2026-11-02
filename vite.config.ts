import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  // The packaged app is loaded with file://; relative asset URLs keep the
  // renderer from resolving /assets against the drive root and showing blank.
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  build: {
    // ★ 不要开 emptyOutDir：outDir 是 dist/，整体清空会连带删掉已经打好的
    //   dist/linux、dist/windows 与 dist/site。应用自己的产物由
    //   scripts/clean-app-dist.cjs 精确清理（挂在 prebuild）。
    emptyOutDir: false,
  },
}));
