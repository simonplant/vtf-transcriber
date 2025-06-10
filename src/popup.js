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

// Add click handlers
startButton.addEventListener('click', async () => {
  debugLog('Start button clicked');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    debugLog('Current tab:', tab.id);
    
    chrome.runtime.sendMessage(
      { type: 'start-recording', target: 'service-worker' },
      (response) => {
        debugLog('Start recording response:', response);
        if (response && response.status === 'started') {
          startButton.style.display = 'none';
          stopButton.style.display = 'block';
          statusElement.textContent = 'Status: Recording...';
        }
      }
    );
  } catch (error) {
    debugLog('Error starting recording:', error);
    statusElement.textContent = 'Error: ' + error.message;
  }
});

stopButton.addEventListener('click', () => {
  debugLog('Stop button clicked');
  chrome.runtime.sendMessage(
    { type: 'stop-recording', target: 'service-worker' },
    (response) => {
      debugLog('Stop recording response:', response);
      if (response && response.status === 'stopped') {
        startButton.style.display = 'block';
        stopButton.style.display = 'none';
        statusElement.textContent = 'Status: Ready to start.';
      }
    }
  );
});

// Check initial status
debugLog('Checking initial status...');
chrome.runtime.sendMessage(
  { type: 'get-status', target: 'service-worker' },
  (response) => {
    debugLog('Initial status response:', response);
    if (response && response.isRecording) {
      startButton.style.display = 'none';
      stopButton.style.display = 'block';
      statusElement.textContent = 'Status: Recording...';
    } else {
      startButton.style.display = 'block';
      stopButton.style.display = 'none';
      statusElement.textContent = 'Status: Ready to start.';
    }
  }
);

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message) => {
  debugLog('Received message in popup:', message);
  if (message.type === 'transcription') {
    debugLog('Received transcription:', message.text);
    statusElement.textContent = `Transcription: ${message.text}`;
  }
});

debugLog('Popup initialized successfully');