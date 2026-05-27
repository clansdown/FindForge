import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    svelte(),
  ],
  server: {
    proxy: {
      '/storage': {
        target: 'http://localhost:8787',
        rewrite: (path) => path.replace(/^\/storage/, ''),
      },
      '/web-proxy': {
        target: 'http://localhost:8788',
        rewrite: (path) => path.replace(/^\/web-proxy/, ''),
      },
      '/openrouter-proxy': {
        target: 'http://localhost:8789',
        rewrite: (path) => path.replace(/^\/openrouter-proxy/, ''),
      },
      '/users-worker': {
        target: 'http://localhost:8790',
        rewrite: (path) => path.replace(/^\/users-worker/, ''),
      },
    },
    headers : {
'Content-Security-Policy':"default-src 'self'; script-src 'self' https://*.clerk.accounts.dev https://*.clerk.com 'unsafe-inline' 'unsafe-eval'; worker-src blob:; connect-src 'self' https://openrouter.ai https://*.clerk.accounts.dev https://*.clerk.com https://findforge-storage.chris-f57.workers.dev https://findforge-web-proxy.chris-f57.workers.dev https://findforge-openrouter.chris-f57.workers.dev https://findforge-users.chris-f57.workers.dev https://*.wikipedia.org https://eutils.ncbi.nlm.nih.gov https://www.newadvent.org https://api.crossref.org; img-src 'self' data: https://*.clerk.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.clerk.com; font-src 'self' https://fonts.gstatic.com https://*.clerk.com; frame-src https://*.clerk.accounts.dev https://*.clerk.com; object-src 'none'; base-uri 'self'; form-action 'self';"

    }
  }
})
