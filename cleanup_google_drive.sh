#!/bin/sh
# Remove Google Drive related files and directories
# Run this from the project root

echo "Removing Google Drive source files..."
rm -f src/lib/google_drive.ts
rm -f src/lib/cloud_storage.ts
rm -f src/CloudStorageSettings.svelte

echo "Removing Google API config files..."
rm -f public/google_api_config.json
rm -f public/google_api_config.example.json

echo "Removing gdrive_secrets directory..."
rm -rf gdrive_secrets/

echo "Removing gapi-script and @types/gapi from node_modules..."
npm uninstall gapi-script 2>/dev/null
npm uninstall @types/gapi @types/gapi.auth2 @types/gapi.client.drive 2>/dev/null

echo "Cleanup complete."
echo "Run 'npm install' to update lockfile, then 'npm run check' to verify."
