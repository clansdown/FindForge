import { copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, '..', 'node_modules', 'extract2md', 'dist', 'pdf.worker.min.mjs');
const dest = resolve(__dirname, '..', 'public', 'pdf.worker.min.mjs');
copyFileSync(src, dest);
console.log(`Copied ${src} → ${dest}`);
