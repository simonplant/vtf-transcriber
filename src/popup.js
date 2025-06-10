// Debug logging function
function debugLog(message, data = null) {
  const logMessage = `[VTF Popup] ${message}`;
  console.log(logMessage, data || '');
  // Send log to background script
  chrome.runtime.sendMessage({
    type: 'log',
    message: logMessage,
    data: data
  }).catch(() => {
    // Ignore errors if background script isn't ready
  });
}

// Helper function to safely get elements
function getElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    debugLog(`Error: Element with id '${id}' not found`);
    throw new Error(`Required element '${id}' not found`);
  }
  return element;
}

// Initialize popup state from storage
async function initializePopup() {
  debugLog('Initializing popup state...');
  try {
    const result = await chrome.storage.local.get([
      'captureState',
      'transcriptionState',
      'stats',
      'lastUpdate'
    ]);
    
    return {
      captureState: result.captureState || 'inactive',
      transcriptionState: result.transcriptionState || 'inactive',
      stats: result.stats || { totalDuration: 0, totalTranscriptions: 0, errorCount: 0 },
      lastUpdate: result.lastUpdate || 'Never'
    };
  } catch (error) {
    debugLog('Failed to initialize popup state:', error);
    throw error;
  }
}

// Initialize UI elements
function initializeUI() {
  debugLog('Initializing UI...');
  
  try {
    // Get UI elements
    const startCaptureBtn = getElement('startCaptureBtn');
    const stopCaptureBtn = getElement('stopCaptureBtn');
    const testConnectionBtn = getElement('testConnectionBtn');
    const statusIndicator = getElement('statusIndicator');
    const statusText = getElement('statusText');
    const captureDuration = getElement('captureDuration');
    const transcriptionStatusText = getElement('transcriptionStatusText');
    const statsContainer = getElement('statsContainer');
    const totalDuration = getElement('totalDuration');
    const totalTranscriptions = getElement('totalTranscriptions');
    const errorCount = getElement('errorCount');
    const lastUpdate = getElement('lastUpdate');

    // Set up event listeners
    startCaptureBtn.onclick = async (e) => {
      e.preventDefault();
      debugLog('Start capture button pressed');
      try {
        const response = await chrome.runtime.sendMessage({ type: 'start-capture' });
        debugLog('Start capture response:', response);
        if (response.status === 'started') {
          updateUIState('active');
        } else {
          debugLog('Failed to start capture:', response.error);
          updateUIState('error');
        }
      } catch (error) {
        debugLog('Error starting capture:', error);
        updateUIState('error');
      }
    };

    stopCaptureBtn.onclick = async (e) => {
      e.preventDefault();
      debugLog('Stop capture button pressed');
      try {
        const response = await chrome.runtime.sendMessage({ type: 'stop-capture' });
        debugLog('Stop capture response:', response);
        if (response.status === 'stopped') {
          updateUIState('inactive');
        } else {
          debugLog('Failed to stop capture:', response.error);
          updateUIState('error');
        }
      } catch (error) {
        debugLog('Error stopping capture:', error);
        updateUIState('error');
      }
    };

    testConnectionBtn.onclick = async (e) => {
      e.preventDefault();
      debugLog('Test connection button pressed');
      try {
        const response = await fetch('http://localhost:3000/health');
        const data = await response.json();
        debugLog('Connection test response:', data);
        if (data.status === 'ok') {
          showNotification('Connection Test', 'Successfully connected to server');
        } else {
          showNotification('Connection Test', 'Server returned unexpected status');
        }
      } catch (error) {
        debugLog('Connection test failed:', error);
        showNotification('Connection Test', 'Failed to connect to server');
      }
    };

    // Initial state check
    checkCaptureState();
    
    debugLog('UI initialization complete');
  } catch (error) {
    debugLog('Failed to initialize UI:', error);
    showNotification('Initialization Error', 'Failed to initialize UI. Please reload the extension.');
  }
}

// Update UI state
function updateUIState(state) {
  debugLog('Updating UI state:', state);
  try {
    const statusIndicator = getElement('statusIndicator');
    const statusText = getElement('statusText');
    const startCaptureBtn = getElement('startCaptureBtn');
    const stopCaptureBtn = getElement('stopCaptureBtn');
    const transcriptionStatusText = getElement('transcriptionStatusText');

    switch (state) {
      case 'active':
        statusIndicator.className = 'status-indicator active';
        statusText.textContent = 'Recording';
        transcriptionStatusText.textContent = 'Processing';
        startCaptureBtn.disabled = true;
        stopCaptureBtn.disabled = false;
        break;
      case 'inactive':
        statusIndicator.className = 'status-indicator';
        statusText.textContent = 'Ready';
        transcriptionStatusText.textContent = 'Inactive';
        startCaptureBtn.disabled = false;
        stopCaptureBtn.disabled = true;
        break;
      case 'error':
        statusIndicator.className = 'status-indicator error';
        statusText.textContent = 'Error';
        transcriptionStatusText.textContent = 'Error';
        startCaptureBtn.disabled = false;
        stopCaptureBtn.disabled = true;
        break;
    }
  } catch (error) {
    debugLog('Error updating UI state:', error);
  }
}

// Check current capture state
async function checkCaptureState() {
  debugLog('Checking capture state...');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get-status' });
    if (chrome.runtime.lastError) {
      throw new Error(`Background script error: ${chrome.runtime.lastError.message}`);
    }
    debugLog('Status check response:', response);
    updateUIState(response.isActive ? 'active' : 'inactive');
    if (response.offscreenStatus) {
      updateTranscriptionState(response.offscreenStatus);
    }
  } catch (error) {
    debugLog('Error checking capture state:', error);
    updateUIState('error');
    // Provide more specific feedback to the user
    getElement('statusText').textContent = 'Comms Error';
    showNotification('Error', 'Cannot connect to the background service. Please try reloading the extension.');
  }
}

// Update transcription state
function updateTranscriptionState(state) {
  debugLog('Updating transcription state:', state);
  try {
    const transcriptionStatusText = getElement('transcriptionStatusText');
    switch (state) {
      case 'initialized':
        transcriptionStatusText.textContent = 'Ready';
        break;
      case 'recording':
        transcriptionStatusText.textContent = 'Processing';
        break;
      case 'error':
        transcriptionStatusText.textContent = 'Error';
        break;
      default:
        transcriptionStatusText.textContent = 'Inactive';
    }
  } catch (error) {
    debugLog('Error updating transcription state:', error);
  }
}

// Update stats display
function updateStats(stats) {
  debugLog('Updating stats:', stats);
  try {
    const totalDuration = getElement('totalDuration');
    const totalTranscriptions = getElement('totalTranscriptions');
    const errorCount = getElement('errorCount');
    const lastUpdate = getElement('lastUpdate');
    const captureDuration = getElement('captureDuration');

    totalDuration.textContent = formatDuration(stats.totalDuration);
    totalTranscriptions.textContent = stats.totalTranscriptions;
    errorCount.textContent = stats.errorCount;
    lastUpdate.textContent = stats.lastUpdate || 'Never';
    if (stats.currentDuration !== undefined) {
      captureDuration.textContent = formatDuration(stats.currentDuration);
    }
  } catch (error) {
    debugLog('Error updating stats:', error);
  }
}

// Format duration in seconds to MM:SS
function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Show notification
function showNotification(title, message) {
  debugLog('Showing notification:', { title, message });
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: title,
    message: message
  });
}

// Listen for state updates from service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'stateUpdate') {
    debugLog('Received state update:', message);
    updateUIState(message.captureState);
    if (message.transcriptionState) {
      updateTranscriptionState(message.transcriptionState);
    }
  } else if (message.type === 'statsUpdate') {
    debugLog('Received stats update:', message);
    updateStats(message.stats);
  }
});

// Initialize the popup when the DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  try {
    debugLog('DOM loaded, initializing popup...');
    const state = await initializePopup();
    updateUIState(state.captureState);
    updateTranscriptionState(state.transcriptionState);
    updateStats(state.stats);
    initializeUI();
  } catch (error) {
    debugLog('Failed to initialize popup:', error);
    showNotification('Initialization Error', 'Failed to initialize popup. Please reload the extension.');
  }
});