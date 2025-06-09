const apiKeyInput = document.getElementById('apiKey');
const debugModeCheckbox = document.getElementById('debugMode');
const saveButton = document.getElementById('save');
const statusElement = document.getElementById('status');

// Load and display saved settings
async function loadOptions() {
  const data = await chrome.storage.local.get(['openaiApiKey', 'debugMode']);
  if (data.openaiApiKey) {
    apiKeyInput.placeholder = "API Key is set. Enter a new key to change.";
  }
  debugModeCheckbox.checked = !!data.debugMode;
}

// Save settings
async function saveOptions() {
  const settings = {
    debugMode: debugModeCheckbox.checked
  };
  // Only save the API key if a new one is entered
  if (apiKeyInput.value) {
    settings.openaiApiKey = apiKeyInput.value;
  }
  
  await chrome.storage.local.set(settings);
  
  statusElement.textContent = 'Options saved!';
  if (apiKeyInput.value) {
    apiKeyInput.value = '';
    apiKeyInput.placeholder = "API Key is set. Enter a new key to change.";
  }
  setTimeout(() => statusElement.textContent = '', 3000);
}

document.addEventListener('DOMContentLoaded', loadOptions);
saveButton.addEventListener('click', saveOptions); 