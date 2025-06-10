// Default settings
const defaultSettings = {
    apiKey: '',
    apiEndpoint: 'https://api.openai.com/v1/audio/transcriptions',
    defaultLanguage: 'en-US',
    maxDuration: 300
};

// Load saved settings
function loadSettings() {
    chrome.storage.sync.get(defaultSettings, (items) => {
        document.getElementById('apiKey').value = items.apiKey;
        document.getElementById('apiEndpoint').value = items.apiEndpoint;
        document.getElementById('defaultLanguage').value = items.defaultLanguage;
        document.getElementById('maxDuration').value = items.maxDuration;
    });
}

// Save settings
function saveSettings() {
    const settings = {
        apiKey: document.getElementById('apiKey').value,
        apiEndpoint: document.getElementById('apiEndpoint').value,
        defaultLanguage: document.getElementById('defaultLanguage').value,
        maxDuration: parseInt(document.getElementById('maxDuration').value, 10)
    };

    chrome.storage.sync.set(settings, () => {
        const status = document.getElementById('status');
        status.textContent = 'Settings saved.';
        status.className = 'status success';
        status.style.display = 'block';
        setTimeout(() => {
            status.style.display = 'none';
        }, 2000);
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', loadSettings);
document.getElementById('save').addEventListener('click', saveSettings); 