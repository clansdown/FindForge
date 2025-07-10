import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  server: {
    // Other server options (port, open, etc.)
    // ...
    headers : {
'Content-Security-Policy':"default-src 'self'; script-src 'self' https://apis.google.com https://accounts.google.com https://www.gstatic.com https://content.googleapis.com 'unsafe-inline' 'unsafe-eval'; frame-src https://accounts.google.com https://content.googleapis.com;  connect-src 'self' https://apis.google.com https://accounts.google.com https://www.googleapis.com https://openrouter.ai https://content.googleapis.com https://oauth2.googleapis.com; img-src 'self' data: http://csi.gstatic.com  https://www.gstatic.com https://content.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://www.gstatic.com; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; form-action 'self';"

    }
  }
})
