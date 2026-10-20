const test = require('node:test'); const assert = require('node:assert/strict');
test('import-export module is represented in the build surface', () => { assert.equal(require('fs').existsSync('packages/import-export/src.ts'), true); });
