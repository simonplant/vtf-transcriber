// popup.js - VTF Capture Dashboard

// DOM elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const testBtn = document.getElementById('testBtn');
const optionsBtn = document.getElementById('optionsBtn');
const statusIndicator = document.getElementById('statusIndicator');
const captureStatus = document.getElementById('captureStatus');
const apiKeyStatus = document.getElementById('apiKeyStatus');
const chunksCount = document.getElementById('chunksCount');
const transcriptionCount = document.getElementById('transcriptionCount');
const activeSpeakers = document.getElementById('activeSpeakers');
const sessionCost = document.getElementById('sessionCost');
const performanceMetrics = document.getElementById('performanceMetrics');
const speechActivity = document.getElementById('speechActivity');
const processingStatus = document.getElementById('processingStatus');
const lastTranscription = document.getElementById('lastTranscription');
const currentTranscript = document.getElementById('currentTranscript');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');

// State
let isTranscribing = false;
let hasApiKey = false;
let sessionStartTime = null;
let totalAudioMinutes = 0;
let lastTranscriptTime = null;
let currentTranscriptPreview = '';

// Whisper API pricing (as of 2024)
const WHISPER_COST_PER_MINUTE = 0.006; // $0.006 per minute

// Start capture
if (startBtn) {
  startBtn.onclick = async () => {
    console.log('[Popup] Start button clicked');
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    
    if (!tab.url || !tab.url.includes('vtf.t3live.com')) {
      showError('Please navigate to VTF first');
      return;
    }
    
    // Track session start
    sessionStartTime = Date.now();
    totalAudioMinutes = 0;
    
    // Send to content script
    chrome.tabs.sendMessage(tab.id, {type: 'start_capture'}, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending to content script:', chrome.runtime.lastError);
        showError('Failed to start capture on page');
      } else {
        console.log('Content script response:', response);
      }
    });
    
    // Also notify background script
    chrome.runtime.sendMessage({type: 'startCapture'}, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending to background:', chrome.runtime.lastError);
      } else {
        console.log('Background response:', response);
        updateStatus(true);
      }
    });
  };
}

// Stop capture
if (stopBtn) {
  stopBtn.onclick = async () => {
    console.log('[Popup] Stop button clicked');
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    
    // Send to content script
    chrome.tabs.sendMessage(tab.id, {type: 'stop_capture'}, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending to content script:', chrome.runtime.lastError);
      } else {
        console.log('Content script response:', response);
      }
    });
    
    // Also notify background script
    chrome.runtime.sendMessage({type: 'stopCapture'}, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending to background:', chrome.runtime.lastError);
      } else {
        console.log('Background response:', response);
        updateStatus(false);
      }
    });
  };
}

// Test connection
if (testBtn) {
  testBtn.onclick = async () => {
    console.log('[Popup] Testing message channel...');
    showSuccess('Testing connections...');
    
    // Test background communication
    chrome.runtime.sendMessage({
      type: 'audioData',
      audioData: new Float32Array(1000).fill(0.5),
      timestamp: Date.now(),
      streamId: 'test-stream'
    }, response => {
      if (chrome.runtime.lastError) {
        console.error('Background test failed:', chrome.runtime.lastError);
        showError('Background connection failed!');
      } else {
        console.log('Background test response:', response);
        showSuccess('Connection test successful!');
      }
    });
  };
}

// Open options
if (optionsBtn) {
  optionsBtn.onclick = () => {
    console.log('[Popup] Opening options page');
    chrome.runtime.openOptionsPage();
  };
}

// Update UI status
function updateStatus(isCapturing) {
  isTranscribing = isCapturing;
  
  if (isCapturing) {
    statusIndicator.classList.add('active');
    captureStatus.textContent = 'Recording';
    captureStatus.classList.add('active');
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else {
    statusIndicator.classList.remove('active');
    captureStatus.textContent = 'Not Capturing';
    captureStatus.classList.remove('active');
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

// Calculate session cost
function calculateSessionCost(chunks, transcriptions) {
  // Estimate audio minutes from chunks (assuming 1-second chunks on average)
  totalAudioMinutes = chunks / 60;
  const cost = totalAudioMinutes * WHISPER_COST_PER_MINUTE;
  return cost;
}

// Update activity display
function updateActivityDisplay(response) {
  // Update speech activity
  const activity = response.speechActivity || 'none';
  speechActivity.textContent = activity.charAt(0).toUpperCase() + activity.slice(1);
  speechActivity.className = `activity-value ${activity}`;
  
  // Update processing status
  const isProcessing = response.isProcessing || false;
  processingStatus.textContent = isProcessing ? 'Active' : 'Idle';
  processingStatus.className = isProcessing ? 'activity-value processing' : 'activity-value none';
  
  // Update last transcription time
  if (response.transcriptionCount > 0) {
    const now = Date.now();
    if (!lastTranscriptTime || response.transcriptionCount !== lastTranscriptTime.count) {
      lastTranscriptTime = { time: now, count: response.transcriptionCount };
    }
    
    const timeSinceLastTranscript = now - lastTranscriptTime.time;
    const timeText = formatTimeSince(timeSinceLastTranscript);
    lastTranscription.textContent = timeText;
    lastTranscription.className = timeSinceLastTranscript < 30000 ? 'activity-time recent' : 'activity-time old';
  } else {
    lastTranscription.textContent = 'Never';
    lastTranscription.className = 'activity-time old';
  }
}

// Format time since last event
function formatTimeSince(ms) {
  if (ms < 1000) return 'Just now';
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  return `${Math.floor(ms / 3600000)}h ago`;
}

// Update current transcript preview
function updateTranscriptPreview() {
  chrome.runtime.sendMessage({type: 'getTranscriptions'}, (response) => {
    if (chrome.runtime.lastError || !response || !response.transcriptions) {
      return;
    }
    
    const transcriptions = response.transcriptions;
    if (transcriptions.length > 0) {
      const latest = transcriptions[transcriptions.length - 1];
      const preview = latest.text.length > 60 ? latest.text.substring(0, 60) + '...' : latest.text;
      const speaker = latest.speaker || 'Unknown';
      
      currentTranscript.innerHTML = `
        <div class="transcript-preview active">
          <strong>${speaker}:</strong> ${preview}
        </div>
      `;
    } else {
      currentTranscript.innerHTML = `
        <div class="transcript-preview empty">
          Waiting for audio...
        </div>
      `;
    }
  });
}

// Check status
function checkStatus() {
  chrome.runtime.sendMessage({type: 'getStatus'}, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[Popup] Error getting status:', chrome.runtime.lastError);
      return;
    }
    
    console.log('[Popup] Status:', response);
    if (response) {
      updateStatus(response.isCapturing);
      
      // Update metrics
      chunksCount.textContent = response.chunksReceived || 0;
      transcriptionCount.textContent = response.transcriptionCount || 0;
      activeSpeakers.textContent = response.activeSpeakers || 0;
      
      // Calculate and display session cost
      const cost = calculateSessionCost(response.chunksReceived || 0, response.transcriptionCount || 0);
      sessionCost.textContent = `$${cost.toFixed(3)}`;
      
      // Color code the cost
      if (cost > 1.0) {
        sessionCost.className = 'metric-value error';
      } else if (cost > 0.5) {
        sessionCost.className = 'metric-value warning';
      } else {
        sessionCost.className = 'metric-value';
      }
      
      // Update activity display
      updateActivityDisplay(response);
      
      // Update API key status
      if (response.hasApiKey) {
        apiKeyStatus.textContent = 'API Key Configured';
        apiKeyStatus.classList.add('success');
        apiKeyStatus.classList.remove('error');
        hasApiKey = true;
      } else {
        apiKeyStatus.textContent = 'API Key Required';
        apiKeyStatus.classList.remove('success');
        apiKeyStatus.classList.add('error');
        hasApiKey = false;
      }
      
      // Update performance metrics if available
      if (response.performance) {
        performanceMetrics.innerHTML = `
          <span>API Calls: ${response.performance.apiCalls}</span>
          <span>Avg: ${response.performance.avgResponseTime}ms</span>
          <span>Errors: ${response.performance.errorRate}%</span>
        `;
      }
    }
  });
  
  // Update transcript preview
  updateTranscriptPreview();
}

// Show error message
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.remove('hidden');
  successMessage.classList.add('hidden');
  setTimeout(() => {
    errorMessage.classList.add('hidden');
  }, 5000);
}

// Show success message
function showSuccess(message) {
  successMessage.textContent = message;
  successMessage.classList.remove('hidden');
  errorMessage.classList.add('hidden');
  setTimeout(() => {
    successMessage.classList.add('hidden');
  }, 3000);
}

// Check API key on load
chrome.storage.local.get(['openaiApiKey'], (result) => {
  hasApiKey = !!(result.openaiApiKey && result.openaiApiKey.trim());
  
  if (!hasApiKey) {
    showError('No API key configured. Click Options to set it up.');
    startBtn.disabled = true;
  }
});

// Initial status check
checkStatus();

// Update periodically
setInterval(() => {
  checkStatus();
}, 3000);

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Popup] DOM loaded, checking tab...');
  
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    const tab = tabs[0];
    if (!tab.url || !tab.url.includes('vtf.t3live.com')) {
      showError('Please navigate to VTF (vtf.t3live.com)');
      startBtn.disabled = true;
      stopBtn.disabled = true;
    }
  });
});