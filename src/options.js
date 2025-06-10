// ===================================================================================
//
// VTF Audio Transcriber - Options Page Logic
//
// ===================================================================================

const log = (...args) => console.log('[VTF Options]', ...args);

// --- DOM Elements ---
const apiKeyInput = document.getElementById('apiKey');
const debugModeCheckbox = document.getElementById('debugMode');
const saveButton = document.getElementById('save');
const statusElement = document.getElementById('status');

// --- Functions ---

// Load settings from storage and display them.
async function loadOptions() {
  log('Loading options...');
  try {
    const { appState } = await chrome.storage.local.get('appState');
    if (appState) {
      log('Found existing state:', appState);
      if (appState.apiKey) {
        apiKeyInput.placeholder = "API Key is set. Enter a new key to overwrite.";
      } else {
        apiKeyInput.placeholder = "Enter your OpenAI API Key";
      }
      debugModeCheckbox.checked = appState.debugMode || false;
    }
  } catch (error) {
    log('Error loading options:', error);
    showStatus(`Error: ${error.message}`, 'error');
  }
}

// Save the current settings from the UI to storage.
async function saveOptions() {
  log('Saving options...');
  try {
    const { appState } = await chrome.storage.local.get('appState');
    const newApiKey = apiKeyInput.value.trim();

    // Update state object
    const newState = {
      ...appState,
      debugMode: debugModeCheckbox.checked
    };

    if (newApiKey) {
      newState.apiKey = newApiKey;
    } else {
      // If the user saves an empty key, remove it from the state.
      newState.apiKey = '';
    }
    
    await chrome.storage.local.set({ appState: newState });
    
    // Notify background script that state has changed
    await chrome.runtime.sendMessage({ type: 'options-updated' });

    // Clear input for security and show success
    apiKeyInput.value = '';
    showStatus('Settings saved successfully!', 'success');
    loadOptions(); // Re-load to update placeholder text
    
  } catch (error) {
    log('Error saving options:', error);
    showStatus(`Error: ${error.message}`, 'error');
  }
}

// Show a temporary status message to the user.
function showStatus(message, type = 'success') {
  statusElement.textContent = message;
  statusElement.className = `status ${type}`;
  setTimeout(() => {
    statusElement.textContent = '';
    statusElement.className = 'status';
  }, 3000);
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', loadOptions);
saveButton.addEventListener('click', saveOptions); 