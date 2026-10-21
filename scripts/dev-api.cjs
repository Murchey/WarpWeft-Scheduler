const path = require('node:path');
const { startApi } = require('../apps/desktop/api.cjs');

const rootDir = path.resolve(__dirname, '..');
startApi({ rootDir, dataDir: path.join(rootDir, 'data'), port: 4317, host: process.env.WARPVEFT_HOST || '127.0.0.1', packaged: false });
console.log('WarpWeft local API: http://127.0.0.1:4317');
