// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * electron-builder afterPack hook
 * Ensures napi-rs native module files are correctly placed in app.asar.unpacked
 * so the napi-rs loader (index.js) can find core.darwin-arm64.node at runtime.
 */
exports.default = async function afterPack(context) {
  const appDir = context.packager.getResourcesDir(context.appOutDir);
  const unpackedCoreDir = path.join(
    appDir,
    'app.asar.unpacked',
    'node_modules',
    '@d3motap3',
    'core'
  );

  // Source: packages/core in the monorepo (scripts/ -> app/ -> packages/ -> core/)
  const coreSourceDir = path.resolve(__dirname, '..', '..', 'core');

  const filesToCopy = [
    'package.json',
    'index.js',
    'index.d.ts',
    'core.darwin-arm64.node',
  ];

  console.log(`[afterPack] Ensuring native module in: ${unpackedCoreDir}`);
  console.log(`[afterPack] Source directory: ${coreSourceDir}`);

  fs.mkdirSync(unpackedCoreDir, { recursive: true });

  for (const file of filesToCopy) {
    const src = path.join(coreSourceDir, file);
    const dest = path.join(unpackedCoreDir, file);

    if (!fs.existsSync(src)) {
      if (file.endsWith('.node')) {
        throw new Error(
          `[afterPack] FATAL: Native binary not found: ${src}\n` +
          `Run "pnpm --filter @d3motap3/core build" before packaging.`
        );
      }
      console.warn(`[afterPack] WARNING: Source file not found: ${src}`);
      continue;
    }

    fs.cpSync(src, dest, { force: true });
    const size = fs.statSync(dest).size;
    console.log(`[afterPack] Copied ${file} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  }

  console.log('[afterPack] Native module setup complete');
};
