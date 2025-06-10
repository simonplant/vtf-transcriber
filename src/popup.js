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
      captureState: result.captureState || 'Inactive',
      transcriptionState: result.transcriptionState || 'Inactive',
      stats: result.stats || { totalDuration: 0, totalTranscriptions: 0, errorCount: 0 },
      lastUpdate: result.lastUpdate || 'Never'
    };
  } catch (error) {
    console.error('Failed to initialize popup state:', error);
    throw error;
  }
}

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
  }
  return element;
}

// Initialize UI elements
function initializeUI() {
  debugLog('Initializing UI...');
  
  // Log all elements in the document
  const allElements = document.querySelectorAll('*');
  debugLog('All elements in document:', Array.from(allElements).map(el => ({
    id: el.id,
    tagName: el.tagName,
    className: el.className
  })));

  // Get UI elements
  const startCaptureBtn = getElement('startCaptureBtn');
  const stopCaptureBtn = getElement('stopCaptureBtn');
  const testConnectionBtn = getElement('testConnectionBtn');
  const statusIndicator = getElement('statusIndicator');
  const statusText = getElement('statusText');
  const statsContainer = getElement('statsContainer');
  const totalDuration = getElement('totalDuration');
  const totalTranscriptions = getElement('totalTranscriptions');
  const errorCount = getElement('errorCount');
  const lastUpdate = getElement('lastUpdate');

  // Verify all elements exist
  const elements = {
    startCaptureBtn,
    stopCaptureBtn,
    testConnectionBtn,
    statusIndicator,
    statusText,
    statsContainer,
    totalDuration,
    totalTranscriptions,
    errorCount,
    lastUpdate
  };

  Object.entries(elements).forEach(([name, element]) => {
    if (element) {
      debugLog(`Found element: ${name}`);
    } else {
      debugLog(`Missing element: ${name}`);
    }
  });

  // Set up event listeners
  if (startCaptureBtn) {
    startCaptureBtn.onmousedown = async (e) => {
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
    debugLog('Start capture button handler attached');
  }

  if (stopCaptureBtn) {
    stopCaptureBtn.onmousedown = async (e) => {
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
    debugLog('Stop capture button handler attached');
  }

  if (testConnectionBtn) {
    testConnectionBtn.onmousedown = async (e) => {
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
    debugLog('Test connection button handler attached');
  }

  // Initial state check
  checkCaptureState();
}

// Update UI state
function updateUIState(state) {
  debugLog('Updating UI state:', state);
  const statusIndicator = getElement('statusIndicator');
  const statusText = getElement('statusText');
  const startCaptureBtn = getElement('startCaptureBtn');
  const stopCaptureBtn = getElement('stopCaptureBtn');

  if (!statusIndicator || !statusText || !startCaptureBtn || !stopCaptureBtn) {
    debugLog('Error: Required UI elements not found for state update');
    return;
  }

  switch (state) {
    case 'active':
      statusIndicator.className = 'status-indicator active';
      statusText.textContent = 'Recording';
      startCaptureBtn.disabled = true;
      stopCaptureBtn.disabled = false;
      break;
    case 'inactive':
      statusIndicator.className = 'status-indicator';
      statusText.textContent = 'Ready';
      startCaptureBtn.disabled = false;
      stopCaptureBtn.disabled = true;
      break;
    case 'error':
      statusIndicator.className = 'status-indicator error';
      statusText.textContent = 'Error';
      startCaptureBtn.disabled = false;
      stopCaptureBtn.disabled = true;
      break;
  }
}

// Check current capture state
async function checkCaptureState() {
  debugLog('Checking capture state...');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get-status' });
    debugLog('Status check response:', response);
    updateUIState(response.isActive ? 'active' : 'inactive');
  } catch (error) {
    debugLog('Error checking capture state:', error);
    updateUIState('error');
  }
}

// Update stats display
function updateStats(stats) {
  debugLog('Updating stats:', stats);
  const totalDuration = getElement('totalDuration');
  const totalTranscriptions = getElement('totalTranscriptions');
  const errorCount = getElement('errorCount');
  const lastUpdate = getElement('lastUpdate');

  if (!totalDuration || !totalTranscriptions || !errorCount || !lastUpdate) {
    debugLog('Error: Required stats elements not found');
    return;
  }

  totalDuration.textContent = formatDuration(stats.totalDuration);
  totalTranscriptions.textContent = stats.totalTranscriptions;
  errorCount.textContent = stats.errorCount;
  lastUpdate.textContent = stats.lastUpdate;
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
    iconUrl: 'icon48.png',
    title: title,
    message: message
  });
}

// Listen for state updates from service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'stateUpdate') {
    debugLog('Received state update:', message);
    updateUIState(message.captureState);
  }
});

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  debugLog('DOM content loaded');
  initializeUI();
});