// popup.js - Updated for your original HTML

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
const transcriptContent = document.getElementById('transcriptContent');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');

// State
let isTranscribing = false;
let hasApiKey = false;

// Start capture
if (startBtn) {
  startBtn.onclick = async () => {
    console.log('[Popup] Start button clicked');
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    
    if (!tab.url || !tab.url.includes('vtf.t3live.com')) {
      showError('Please navigate to VTF first');
      return;
    }
    
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
    captureStatus.textContent = 'Capturing';
    captureStatus.classList.add('success');
    captureStatus.classList.remove('danger');
    startBtn.textContent = 'Capturing...';
    startBtn.classList.add('active');
  } else {
    statusIndicator.classList.remove('active');
    captureStatus.textContent = 'Not Capturing';
    captureStatus.classList.remove('success');
    captureStatus.classList.add('danger');
    startBtn.textContent = 'Start Capture';
    startBtn.classList.remove('active');
  }
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
      chunksCount.textContent = response.chunksReceived || 0;
      transcriptionCount.textContent = response.transcriptionCount || 0;
      
      // Update activity level if element exists
      const activityElement = document.getElementById('activityLevel');
      if (activityElement) {
        const activityLevel = response.speechActivity || 'none';
        activityElement.textContent = activityLevel.charAt(0).toUpperCase() + activityLevel.slice(1);
        
        switch (activityLevel) {
          case 'high':
            activityElement.className = 'info-value success';
            break;
          case 'low':
            activityElement.className = 'info-value';
            break;
          default:
            activityElement.className = 'info-value danger';
        }
      }
      
      const speakersElement = document.getElementById('activeSpeakers');
      if (speakersElement) {
        speakersElement.textContent = response.activeSpeakers || 0;
      }
      
      // Update API key status
      if (response.hasApiKey) {
        apiKeyStatus.textContent = 'Configured';
        apiKeyStatus.classList.add('success');
        apiKeyStatus.classList.remove('danger');
        hasApiKey = true;
      } else {
        apiKeyStatus.textContent = 'Not configured';
        apiKeyStatus.classList.remove('success');
        apiKeyStatus.classList.add('danger');
        hasApiKey = false;
      }
    }
  });
}

// Load transcriptions
function loadTranscriptions() {
  chrome.runtime.sendMessage({type: 'getTranscriptions'}, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[Popup] Error getting transcriptions:', chrome.runtime.lastError);
      return;
    }
    
    if (response && response.transcriptions) {
      if (response.transcriptions.length === 0) {
        transcriptContent.innerHTML = '<div class="empty-state">No transcriptions yet. Start capturing to see results.</div>';
      } else {
        transcriptContent.innerHTML = '';
        // Show last 10 transcriptions
        const recent = response.transcriptions.slice(-10).reverse();
        recent.forEach(trans => {
          const entry = document.createElement('div');
          entry.className = 'transcript-entry';
          const time = new Date(trans.timestamp).toLocaleTimeString();
          const speaker = trans.speaker || trans.streamId?.split('-')[1] || 'Unknown';
          entry.innerHTML = `
            <div class="transcript-time">${time} - ${speaker}</div>
            <div class="transcript-text">${trans.text}</div>
          `;
          transcriptContent.appendChild(entry);
        });
      }
    }
  });
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
loadTranscriptions();

// Update periodically
setInterval(() => {
  checkStatus();
  loadTranscriptions();
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