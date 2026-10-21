import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  // The packaged app is loaded with file://; relative asset URLs keep the
  // renderer from resolving /assets against the drive root and showing blank.
  base: command === 'build' ? './' : '/',
  plugins: [react()],
}));
