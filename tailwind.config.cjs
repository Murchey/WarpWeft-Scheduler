const { heroui } = require('@heroui/theme');

module.exports = {
  content: ['./index.html', './apps/renderer/src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  plugins: [heroui()],
};
