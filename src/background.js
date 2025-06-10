// A simple map to track which tab is being recorded.
const activeTab = {
  id: null,
  streamId: null,
};

// --- Offscreen Document Management ---

async function hasOffscreenDocument() {
  // Check all existing contexts for an offscreen document.
  if (chrome.runtime.getContexts) {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    return !!existingContexts.find(c => c.documentUrl?.endsWith('offscreen.html'));
  }
  return false;
}

async function setupOffscreenDocument() {
  if (await hasOffscreenDocument()) {
      console.log("Offscreen document already exists.");
      return;
  }
  console.log("Creating offscreen document...");
  await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Recording tab audio for transcription'
  });
}

// --- Transcription Logic ---

async function transcribeAudio(audioBlob) {
    const { openaiApiKey } = await chrome.storage.local.get('openaiApiKey');
    if (!openaiApiKey) {
        showNotification('API Key Missing', 'Please set your OpenAI API key in the extension options.');
        return;
    }

    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');

    try {
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${openaiApiKey}` },
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Unknown API error');
        }

        const result = await response.json();
        if (result.text && result.text.trim()) {
            console.log(`Transcription: `, result.text);
            showNotification('Transcription Received', result.text.trim());
        }
    } catch (error) {
        console.error("Transcription error:", error);
        showNotification('Transcription Failed', error.message);
    }
}

// --- Main Event Listeners ---

chrome.runtime.onMessage.addListener(async (request, sender) => {
    if (request.target === 'background') {
        if (request.type === 'startCapture') {
            await startCapture(request.tabId);
        } else if (request.type === 'stopCapture') {
            await stopCapture();
        } else if (request.type === 'getStatus') {
            return { isActive: activeTab.id === request.tabId };
        }
    } else if (request.target === 'service-worker' && request.type === 'audio-blob') {
        await transcribeAudio(request.data.blob);
    }
    return true;
});

// --- Capture Control Functions ---

async function startCapture(tabId) {
    if (activeTab.id) {
        console.warn("Capture is already active on another tab.");
        return;
    }

    await setupOffscreenDocument();

    try {
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
        
        activeTab.id = tabId;
        activeTab.streamId = streamId;

        chrome.runtime.sendMessage({
            type: 'start-recording',
            target: 'offscreen',
            streamId: streamId,
        });

        chrome.action.setIcon({ path: 'icons/icon48-active.png' });
        chrome.action.setBadgeText({ text: 'REC' });
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });

    } catch (error) {
        console.error("Failed to start capture:", error);
        showNotification('Capture Error', `Could not start audio capture: ${error.message}`);
        await cleanup();
    }
}

async function stopCapture() {
    if (!activeTab.id) {
        console.warn("No active capture to stop.");
        return;
    }
    chrome.runtime.sendMessage({
      type: 'stop-recording',
      target: 'offscreen',
    });
    await cleanup();
}

async function cleanup() {
    activeTab.id = null;
    activeTab.streamId = null;
    chrome.action.setIcon({ path: 'icons/icon48.png' });
    chrome.action.setBadgeText({ text: '' });
    console.log("Capture stopped and resources cleaned up.");
}

function showNotification(title, message) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: title,
        message: message
    });
}

// Ensure cleanup happens if the recorded tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === activeTab.id) {
        stopCapture();
    }
});