// Debug logging function
function debugLog(message) {
  console.log('[VTF DEBUG]', message);
}

// Initialize state
let activeTab = { id: null, streamId: null };
let isRecording = false;

debugLog('Background service worker initializing...');

// Handle messages from popup and offscreen
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  debugLog('Received message:', message);

  if (message.target === 'service-worker') {
    if (message.type === 'start-recording') {
      const tabId = sender.tab.id;
      debugLog('Starting capture for tab:', tabId);
      startCapture(tabId)
        .then(() => {
          debugLog('Capture started successfully');
          sendResponse({ status: 'started' });
        })
        .catch((error) => {
          debugLog('Error starting capture:', error);
          sendResponse({ status: 'error', error: error.message });
        });
    } else if (message.type === 'stop-recording') {
      debugLog('Stopping recording...');
      stopCapture();
      sendResponse({ status: 'stopped' });
    } else if (message.type === 'get-status') {
      debugLog('Getting status for tab:', sender.tab.id);
      sendResponse({ isRecording: isRecording });
    } else if (message.type === 'audio-blob') {
      debugLog('Received audio blob for transcription');
      transcribeAudio(message.data);
    }
  }
  return true;
});

async function startCapture(tabId) {
  debugLog('Starting capture for tab:', tabId);
  
  try {
    // Check for existing offscreen document
    const existingDocs = await chrome.offscreen.getDocuments();
    debugLog('Checking for existing offscreen document:', existingDocs);
    
    if (existingDocs.length === 0) {
      debugLog('Creating offscreen document...');
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_CAPTURE'],
        justification: 'Recording audio from tab'
      });
      debugLog('Offscreen document created successfully');
    }

    // Start capture
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture({ audio: true, video: false }, (stream) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(stream.id);
        }
      });
    });

    debugLog('Capture started with stream ID:', streamId);
    
    // Update state
    activeTab.id = tabId;
    activeTab.streamId = streamId;
    isRecording = true;

    // Update icon
    chrome.action.setIcon({ path: 'icons/icon48.png' });
    chrome.action.setBadgeText({ text: 'REC' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });

    // Send stream to offscreen document
    chrome.runtime.sendMessage({
      type: 'start-recording',
      target: 'offscreen',
      streamId: streamId
    });

    debugLog('Capture setup completed successfully');
  } catch (error) {
    debugLog('Error in startCapture:', error);
    throw error;
  }
}

async function stopCapture() {
  debugLog('Stopping capture...');
  if (isRecording) {
    isRecording = false;
    activeTab.id = null;
    activeTab.streamId = null;
    
    // Reset icon
    chrome.action.setIcon({ path: 'icons/icon48.png' });
    chrome.action.setBadgeText({ text: '' });
    
    // Stop recording in offscreen document
    chrome.runtime.sendMessage({
      type: 'stop-recording',
      target: 'offscreen'
    });
    
    // Close offscreen document
    try {
      await chrome.offscreen.closeDocument();
      debugLog('Offscreen document closed successfully');
    } catch (error) {
      debugLog('Error closing offscreen document:', error);
    }
  }
}

// --- Transcription Logic ---

async function transcribeAudio(audioBlob) {
  debugLog('Starting transcription process...');
  
  // Get API key from storage
  const { apiKey } = await chrome.storage.sync.get('apiKey');
  
  if (!apiKey) {
    debugLog('API Key missing, showing notification');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'API Key Required',
      message: 'Please set your OpenAI API key in the extension options.',
      priority: 2
    });
    return;
  }

  try {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', 'whisper-1');

    debugLog('Sending request to OpenAI API...');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    const data = await response.json();
    debugLog('Transcription received:', data.text);
    
    // Send transcription to popup
    chrome.runtime.sendMessage({
      type: 'transcription',
      text: data.text
    });
  } catch (error) {
    debugLog('Transcription error:', error.message);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Transcription Error',
      message: error.message,
      priority: 2
    });
  }
}

// Ensure cleanup happens if the recorded tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === activeTab.id) {
        stopCapture();
    }
});

debugLog('Background service worker initialized successfully');