<script lang="ts">
    import { getLocalPreference, setLocalPreference } from "./lib/storage";
    import { authorizeDrive, listDriveFiles, readDriveFile } from "./lib/google_drive";
    import ModalDialog from "./lib/ModalDialog.svelte";

    const STORAGE_KEY = "googleDriveCredentials";
    const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
    
    export let isOpen: boolean = false;

    let isGoogleDriveSetup: boolean = false;
    let showDisconnectConfirmation: boolean = false;
    let googleDriveFiles: any[] = [];

    $: if (isOpen) {
        checkGoogleDriveSetup();
        loadGoogleDriveFiles();
    }

    function checkGoogleDriveSetup() {
        const savedCredentials = getLocalPreference<any>("googleDriveCredentials", null);
        isGoogleDriveSetup = Boolean(savedCredentials?.access_token);
    }

    async function loadGoogleDriveFiles() {
        if (isGoogleDriveSetup) {
            try {
                googleDriveFiles = await listDriveFiles();
            } catch (error) {
                console.error("Failed to load Google Drive files:", error);
                googleDriveFiles = [];
            }
        } else {
            googleDriveFiles = [];
        }
    }

    async function setupGoogleDrive() {
        try {
            await authorizeDrive();
            console.log("Google Drive authorized successfully.");
            checkGoogleDriveSetup();
            await loadGoogleDriveFiles();
        } catch (error) {
            console.error("Failed to setup Google Drive:", error);
            alert("Failed to setup Google Drive. Please try again.");
        }
    }

    async function copyToLocalStorage() {
        try {
            const files = await listDriveFiles();
            if (!files.length) {
                alert("No files found in Google Drive to copy.");
                return;
            }

            for (const file of files) {
                if (['text/plain', 'application/json'].includes(file.mimeType)) {
                    const content = await readDriveFile(file.id);
                    setLocalPreference(file.name, content);
                }
            }
            alert(`Copied ${files.length} files from Google Drive to local storage.`);
        } catch (error : any) {
            console.error("Failed to copy data from Google Drive:", error);
            alert(`Failed to copy data: ${error.message}`);
        }
    }

    function disconnectGoogleDrive() {
        showDisconnectConfirmation = true;
    }

    function confirmDisconnect() {
        setLocalPreference("googleDriveCredentials", null);
        isGoogleDriveSetup = false;
        showDisconnectConfirmation = false;
        alert("Google Drive has been disconnected.");
    }

    function cancelDisconnect() {
        showDisconnectConfirmation = false;
    }
</script>

<ModalDialog on:close={() => (isOpen = false)} {isOpen}>
    <h2>Cloud Storage Settings</h2>

    <div class="form-group">
        <p class="help-text">
            Set up cloud storage to share settings, conversations, and other data between devices.
        </p>
        <h4>Google Drive</h4>
        {#if !isGoogleDriveSetup}
            <button class="btn btn-primary" on:click={setupGoogleDrive}>Set Up Google Drive</button>
        {:else}
            <div class="button-group">
                <button on:click={copyToLocalStorage}>Copy to Local Storage</button>
                <button on:click={disconnectGoogleDrive}>Disconnect Google Drive</button>
            </div>
            {#if showDisconnectConfirmation}
                <div class="confirmation">
                    <p>Are you sure you want to disconnect Google Drive? This will not delete any data on Google Drive.</p>
                    <div class="button-group">
                        <button on:click={cancelDisconnect}>Cancel</button>
                        <button on:click={confirmDisconnect}>Confirm</button>
                    </div>
                </div>
            {/if}
            <div class="file-list">
                <h5>Files in Google Drive:</h5>
                {#if googleDriveFiles.length > 0}
                    <ul>
                        {#each googleDriveFiles as file}
                            <li>{file.name} (Last modified: {file.modifiedTime})</li>
                        {/each}
                    </ul>
                {:else}
                    <p>No files found in Google Drive.</p>
                {/if}
            </div>
        {/if}
    </div>

    <div class="button-group">
        <button on:click={() => (isOpen = false)}>Done</button>
    </div>
</ModalDialog>

<style>
    .form-group {
        margin-bottom: 1rem;
    }

    .button-group {
        display: flex;
        justify-content: flex-end;
        gap: 1rem;
        margin-top: 1rem;
    }

    .confirmation {
        margin-top: 1rem;
        padding: 1rem;
        background-color: #444;
        border-radius: 4px;
    }

    .file-list {
        margin-top: 1rem;
        padding: 1rem;
        background-color: #333;
        border-radius: 4px;
        max-height: 300px;
        overflow-y: auto;
    }

    .file-list h5 {
        margin-top: 0;
    }

    .file-list ul {
        list-style-type: none;
        padding: 0;
    }

    .file-list li {
        padding: 0.5rem 0;
        border-bottom: 1px solid #444;
    }

    .help-text {
        padding: .5rem 1rem;
        border: 1px solid #aaa;
        border-radius: .3rem;
        margin-left: 1rem;
        margin-right: 1rem;
    }
</style>
