// Default settings
const defaultSettings = {
    apiKey: '',
    debugMode: false
};

// Simple debug logging function
function debugLog(...args) {
    chrome.storage.sync.get({ debugMode: false }, (items) => {
        if (items.debugMode) {
            console.log('[VTF DEBUG]', ...args);
        }
    });
}

// Load saved settings
function loadSettings() {
    chrome.storage.sync.get(defaultSettings, (items) => {
        const apiKeyInput = document.getElementById('apiKey');
        const debugModeCheckbox = document.getElementById('debugMode');
        
        if (apiKeyInput) {
            apiKeyInput.value = items.apiKey || '';
        }
        if (debugModeCheckbox) {
            debugModeCheckbox.checked = items.debugMode || false;
        }
        
        updateApiKeyStatus(items.apiKey);
        debugLog('Settings loaded:', items);
    });
}

// Update API key status display
function updateApiKeyStatus(apiKey) {
    const status = document.getElementById('status');
    if (!status) return;

    if (!apiKey) {
        status.textContent = 'No API key set. Please enter your OpenAI API key.';
        status.className = 'status warning';
    } else {
        status.textContent = 'API key is set and ready to use.';
        status.className = 'status success';
    }
    status.style.display = 'block';
}

// Save settings
function saveSettings() {
    const apiKeyInput = document.getElementById('apiKey');
    const debugModeCheckbox = document.getElementById('debugMode');
    if (!apiKeyInput || !debugModeCheckbox) return;

    const settings = {
        apiKey: apiKeyInput.value,
        debugMode: debugModeCheckbox.checked
    };

    chrome.storage.sync.set(settings, () => {
        const status = document.getElementById('status');
        if (!status) return;

        if (settings.apiKey) {
            status.textContent = 'Settings saved successfully.';
            status.className = 'status success';
        } else {
            status.textContent = 'No API key set. Please enter your OpenAI API key.';
            status.className = 'status warning';
        }
        status.style.display = 'block';
        debugLog('Settings saved:', settings);
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    const saveButton = document.getElementById('save');
    if (saveButton) {
        saveButton.addEventListener('click', saveSettings);
    }
}); 