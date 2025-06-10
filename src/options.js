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
const saveButton = document.getElementById('save');
const statusElement = document.getElementById('status');

async function loadOptions() {
    const data = await chrome.storage.local.get('apiKey');
    if (data.apiKey) {
        apiKeyInput.placeholder = "API Key is set. Enter a new key to change it.";
    }
}

async function saveOptions() {
    // Only save if the input has a value.
    if (apiKeyInput.value) {
        await chrome.storage.local.set({ apiKey: apiKeyInput.value });
        statusElement.textContent = 'API Key saved successfully!';
        apiKeyInput.value = ''; // Clear the input after saving
        apiKeyInput.placeholder = "API Key is set. Enter a new key to change it.";
    } else {
        statusElement.textContent = 'Please enter an API key to save.';
    }
    setTimeout(() => { statusElement.textContent = ''; }, 3000);
}

// Initialize
document.addEventListener('DOMContentLoaded', loadOptions);
saveButton.addEventListener('click', saveOptions); 