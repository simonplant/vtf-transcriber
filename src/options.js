// Default settings
const defaultSettings = {
    apiKey: '',
    debugMode: false
};

// Simple debug logging function
function debugLog(...args) {
    chrome.storage.local.get({ debugMode: false }, (items) => {
        if (items.debugMode) {
            console.log('[VTF DEBUG]', ...args);
        }
    });
}

const apiKeyInput = document.getElementById('apiKey');
const debugModeCheckbox = document.getElementById('debugMode');
const saveButton = document.getElementById('save');
const statusElement = document.getElementById('status');

async function loadOptions() {
    // CORRECTED: Reads from `local` storage for both settings.
    const data = await chrome.storage.local.get(['apiKey', 'debugMode']);
    if (data.apiKey) apiKeyInput.placeholder = "API Key is set. Enter to change.";
    debugModeCheckbox.checked = !!data.debugMode;
}

async function saveOptions() {
    const settings = { debugMode: debugModeCheckbox.checked };
    if (apiKeyInput.value) settings.apiKey = apiKeyInput.value;
    
    // CORRECTED: Saves to `local` storage.
    await chrome.storage.local.set(settings);
    
    statusElement.textContent = 'Options saved!';
    if (apiKeyInput.value) {
        apiKeyInput.value = '';
        apiKeyInput.placeholder = "API Key is set.";
    }
    setTimeout(() => { statusElement.textContent = ''; }, 3000);
}

// Initialize
document.addEventListener('DOMContentLoaded', loadOptions);
saveButton.addEventListener('click', saveOptions); 