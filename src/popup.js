// Debug logging function
function debugLog(message) {
  console.log('[VTF DEBUG]', message);
}

// Initialize popup
debugLog('Popup initializing...');

// Get DOM elements
const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const statusElement = document.getElementById('popupStatus');

if (!startButton || !stopButton || !statusElement) {
  debugLog('Error: Required DOM elements not found');
  throw new Error('Required DOM elements not found');
}

debugLog('DOM elements found successfully');

// Send a message to the background script to start the capture.
// The background script will know which tab this came from via the `sender` object.
startButton.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'start-capture' });
  window.close();
});

stopButton.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'stop-capture' });
  window.close();
});

// When the popup opens, ask the background script for the current status.
document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    // The background script compares this tab's ID to the activeTabId
    const response = await chrome.runtime.sendMessage({ type: 'get-status' });
    if (response?.isActive) {
      statusElement.textContent = `Status: Recording`;
      startButton.style.display = 'none';
      stopButton.style.display = 'block';
    } else {
      statusElement.textContent = `Status: Inactive`;
    }
  } catch (e) {
    statusElement.textContent = 'Status: Ready to start.';
  }
});

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message) => {
  debugLog('Received message in popup:', message);
  if (message.type === 'transcription') {
    debugLog('Received transcription:', message.text);
    statusElement.textContent = `Transcription: ${message.text}`;
  }
});

debugLog('Popup initialized successfully');