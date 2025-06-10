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

// Get UI elements
const apiKeyInput = document.getElementById('apiKey');
const debugModeCheckbox = document.getElementById('debugMode');
const saveButton = document.getElementById('save');
const statusElement = document.getElementById('status');

// Load saved settings
async function loadOptions() {
    try {
        const data = await chrome.storage.local.get(['apiKey', 'debugMode']);
        
        // Set API key placeholder if it exists
        if (data.apiKey) {
            apiKeyInput.placeholder = "API Key is set. Enter a new key to change it.";
        }
        
        // Set debug mode checkbox
        debugModeCheckbox.checked = data.debugMode || false;
        
        debugLog('Options loaded:', data);
    } catch (error) {
        console.error('Failed to load options:', error);
        showStatus('Failed to load settings', 'warning');
    }
}

// Save settings
async function saveOptions() {
    try {
        const settings = {
            apiKey: apiKeyInput.value || (await chrome.storage.local.get('apiKey')).apiKey,
            debugMode: debugModeCheckbox.checked
        };

        // Only save if we have an API key
        if (!settings.apiKey) {
            showStatus('Please enter an API key to save.', 'warning');
            return;
        }

        await chrome.storage.local.set(settings);
        
        // Clear the API key input but keep the value in storage
        apiKeyInput.value = '';
        apiKeyInput.placeholder = "API Key is set. Enter a new key to change it.";
        
        showStatus('Settings saved successfully!', 'success');
        debugLog('Settings saved:', { ...settings, apiKey: '***' });
    } catch (error) {
        console.error('Failed to save options:', error);
        showStatus('Failed to save settings', 'warning');
    }
}

// Show status message
function showStatus(message, type = 'success') {
    statusElement.textContent = message;
    statusElement.className = `status ${type}`;
    setTimeout(() => { 
        statusElement.textContent = '';
        statusElement.className = 'status';
    }, 3000);
}

// Initialize
document.addEventListener('DOMContentLoaded', loadOptions);
saveButton.addEventListener('click', saveOptions); 