import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import fs from 'fs';
import path from 'path';

declare function require(name: string): any;

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    svelte(),
    {
      name: 'exclude-clerk-key',
      closeBundle() {
          const distPath = path.resolve('dist', 'clerk-key.js');
          if (fs.existsSync(distPath)) {
            fs.unlinkSync(distPath);
          }
      }
    }
  ],
  server: {
    // Other server options (port, open, etc.)
    // ...
    headers : {
'Content-Security-Policy':"default-src 'self'; script-src 'self' https://*.clerk.accounts.dev https://*.clerk.com 'unsafe-inline' 'unsafe-eval'; worker-src blob:; connect-src 'self' https://openrouter.ai https://*.clerk.accounts.dev https://*.clerk.com https://findforge-storage.chris-f57.workers.dev https://findforge-web-proxy.chris-f57.workers.dev http://localhost:8787 http://localhost:8788 https://*.wikipedia.org https://eutils.ncbi.nlm.nih.gov https://www.newadvent.org; img-src 'self' data: https://*.clerk.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.clerk.com; font-src 'self' https://fonts.gstatic.com https://*.clerk.com; frame-src https://*.clerk.accounts.dev https://*.clerk.com; object-src 'none'; base-uri 'self'; form-action 'self';"

    }
  }
})
