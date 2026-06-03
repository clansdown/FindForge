#!/usr/bin/env bash
set -euo pipefail
mkdir -p public
cp node_modules/extract2md/dist/pdf.worker.min.mjs public/pdf.worker.min.mjs
npm run build
