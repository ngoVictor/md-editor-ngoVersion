@echo off
node "scripts/copy-vditor-assets.mjs" || exit /b 1
node "node_modules/typescript/bin/tsc" || exit /b 1
node "node_modules/vite/bin/vite.js" build || exit /b 1
