// A mapping of tab IDs to their recording state
const activeTabs = new Map();

// Manages the audio buffer for a single user
class UserBufferManager {
    constructor(userId, config) {
      this.userId = userId;
      this.config = config;
      this.chunks = [];
      this.totalSamples = 0;
    }
  
    addChunk(samples) {
      this.chunks.push({ samples });
      this.totalSamples += samples.length;
    }
  
    isReadyToTranscribe() {
      const duration = this.totalSamples / 16000; // Assuming 16kHz sample rate
      return duration >= this.config.bufferDuration;
    }
  
    extractForTranscription() {
      if (this.chunks.length === 0) return null;
      const allSamples = [];
      this.chunks.forEach(chunk => allSamples.push(...chunk.samples));
      this.chunks = [];
      this.totalSamples = 0;
      return { samples: allSamples };
    }
  }
  
  // --- Offscreen Document Management ---

  async function hasOffscreenDocument() {
    // Check all existing contexts for an offscreen document.
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    return !!existingContexts.find(c => c.documentUrl?.endsWith('offscreen.html'));
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

  // --- Main Service Logic ---

  class VTFTranscriptionService {
    constructor() {
      this.userBuffers = new Map();
      this.activeTranscriptions = new Map();
      this.config = { 
        bufferDuration: 1.5, 
        silenceTimeout: 2000,
        messageTimeout: 5000,
        heartbeatTimeout: 10000 // 10 seconds without heartbeat means tab is dead
      };
      this.apiKey = null;
      this.speakerMap = new Map([
          ['XRcupJu26dK_sazaAAPK', 'DP'],
          ['O3e0pz1234K_cazaAAPK', 'Kira']
      ]);
      this.init();
    }
  
    async init() {
      try {
        const storage = await chrome.storage.local.get(['openaiApiKey']);
        this.apiKey = storage.openaiApiKey;
        if (!this.apiKey) {
          console.error('[Service Worker] No API key configured');
          this.showNotification('Configuration Required', 'Please set your OpenAI API key in the extension options.');
        }
  
        chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
        chrome.runtime.onMessage.addListener(this.handleMessageFromOffscreen.bind(this));
        chrome.storage.onChanged.addListener(this.handleStorageChange.bind(this));
        chrome.action.onClicked.addListener(this.toggleCapture.bind(this));
        chrome.tabs.onRemoved.addListener(this.handleTabRemoval.bind(this));
  
        // Start heartbeat checker
        this.startHeartbeatChecker();
      } catch (error) {
        console.error('[Service Worker] Initialization error:', error);
        this.showNotification('Initialization Error', 'Failed to initialize the extension. Please reload the page.');
      }
    }
  
    startHeartbeatChecker() {
      setInterval(() => {
        const now = Date.now();
        activeTabs.forEach((status, tabId) => {
          if (now - status.lastHeartbeat > this.config.heartbeatTimeout) {
            console.log(`[Service Worker] Tab ${tabId} heartbeat timeout, marking as inactive`);
            activeTabs.delete(tabId);
          }
        });
      }, 5000); // Check every 5 seconds
    }
  
    handleStorageChange(changes, area) {
      if (area === 'local' && changes.openaiApiKey) {
        this.apiKey = changes.openaiApiKey.newValue;
        console.log('[Service Worker] OpenAI API key updated.');
        if (this.apiKey) {
          this.showNotification('API Key Updated', 'Your OpenAI API key has been successfully updated.');
        }
      }
    }
  
    async handleTabRemoval(tabId) {
      if (activeTabs.has(tabId)) {
        console.log(`Tab ${tabId} closed, cleaning up.`);
        await this.stopCapture(tabId, true);
      }
    }
  
    async toggleCapture(tab) {
      if (!tab.id) return;
  
      if (activeTabs.has(tab.id)) {
        await this.stopCapture(tab.id);
      } else {
        await this.startCapture(tab);
      }
    }
  
    async startCapture(tab) {
      if (!this.apiKey) {
        this.showNotification('API Key Missing', 'Please set your OpenAI API key in options.');
        return;
      }
      if (tab.url?.startsWith('chrome://')) {
          this.showNotification('Capture Failed', 'Cannot capture internal Chrome pages.');
          return;
      }
  
      await setupOffscreenDocument();
  
      try {
          const streamId = await chrome.tabCapture.getMediaStreamId({
              targetTabId: tab.id,
          });
  
          activeTabs.set(tab.id, { streamId });
  
          chrome.runtime.sendMessage({
              type: 'start-recording',
              target: 'offscreen',
              streamId: streamId,
              tabId: tab.id
          });
  
          this.updateUiForTab(tab.id, true);
  
      } catch (error) {
          console.error('Failed to start capture:', error);
          this.showNotification('Capture Error', `Could not start audio capture: ${error.message}`);
          await this.cleanup(tab.id);
      }
    }
  
    async stopCapture(tabId, tabIsClosing = false) {
      if (!tabIsClosing) {
        chrome.runtime.sendMessage({
          type: 'stop-recording',
          target: 'offscreen',
        });
      }
      await this.cleanup(tabId);
    }
  
    async cleanup(tabId) {
      if (activeTabs.has(tabId)) {
        activeTabs.delete(tabId);
      }
      this.updateUiForTab(tabId, false);
    }
  
    updateUiForTab(tabId, isRecording) {
      const iconPath = isRecording ? 'icons/icon48.png' : 'icons/icon128.png';
      const badgeText = isRecording ? 'REC' : '';
      chrome.action.setIcon({ tabId, path: iconPath });
      chrome.action.setBadgeText({ tabId, text: badgeText });
      if (isRecording) {
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#FF0000' });
      }
    }
  
    async handleMessage(request, sender) {
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Message timeout')), this.config.messageTimeout)
      );
      
      try {
        return await Promise.race([
          this.processMessage(request, sender),
          timeout
        ]);
      } catch (error) {
        console.error('[Service Worker] Message handling error:', error);
        return { error: error.message };
      }
    }
  
    async processMessage(request, sender) {
      switch (request.type) {
        case 'audio-blob':
          this.handleAudioBlob(request);
          return { received: true };
  
        case 'startCapture':
          if (!this.apiKey) {
            throw new Error('OpenAI API key is not configured');
          }
          await chrome.scripting.executeScript({
            target: { tabId: request.tabId },
            files: ['dist/content.bundle.js']
          });
          activeTabs.set(request.tabId, { 
            streams: 0,
            lastHeartbeat: Date.now()
          });
          return { started: true };
        
        case 'stopCapture':
          await chrome.tabs.sendMessage(request.tabId, { type: 'stopCapture' });
          activeTabs.delete(request.tabId);
          return { stopped: true };
  
        case 'heartbeat':
          if (activeTabs.has(sender.tab.id)) {
            const status = activeTabs.get(sender.tab.id);
            status.lastHeartbeat = Date.now();
            status.streams = request.data.streamCount;
            activeTabs.set(sender.tab.id, status);
          }
          return { received: true };
  
        case 'getStatus':
          const status = activeTabs.get(request.tabId);
          return status ? { 
            isActive: true, 
            streams: status.streams 
          } : { isActive: false };
  
        default:
          throw new Error('Unknown message type');
      }
    }
  
    showNotification(title, message) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title,
        message
      });
    }
  
    handleAudioBlob(request) {
      const { userId, chunk } = request;
      if (!this.userBuffers.has(userId)) {
        this.userBuffers.set(userId, new UserBufferManager(userId, this.config));
      }
      const buffer = this.userBuffers.get(userId);
      buffer.addChunk(chunk);
      if (buffer.isReadyToTranscribe()) {
        this.transcribeUserBuffer(userId);
      }
    }
  
    async transcribeUserBuffer(userId) {
      if (this.activeTranscriptions.has(userId)) return;
  
      const buffer = this.userBuffers.get(userId);
      if (!buffer || !buffer.hasData()) return;
      
      const audioData = buffer.extractForTranscription();
      if (!audioData) return;
  
      try {
        this.activeTranscriptions.set(userId, true);
        await this.performTranscription(userId, audioData);
      } catch (error) {
        console.error(`[Service Worker] Transcription error for ${userId}:`, error);
      } finally {
        this.activeTranscriptions.delete(userId);
      }
    }
  
    async performTranscription(userId, audioData) {
      if (!this.apiKey) {
        this.showNotification('Transcription Failed', 'OpenAI API key is not set. Please set it in the extension options.');
        throw new Error('No API key configured');
      }
  
      const wavBlob = this.createWAV(new Float32Array(audioData.samples), 16000);
      const formData = new FormData();
      formData.append('file', wavBlob, 'audio.wav');
      formData.append('model', 'whisper-1');
      formData.append('language', 'en');
  
      // Implement exponential backoff
      let retryCount = 0;
      const maxRetries = 3;
      const baseDelay = 1000;
  
      while (retryCount < maxRetries) {
        try {
          const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiKey}` },
            body: formData
          });
  
          if (!response.ok) {
            const error = await response.json();
            const errorMessage = error.error?.message || 'Unknown API error';
            
            if (response.status === 429) { // Rate limit
              retryCount++;
              const delay = baseDelay * Math.pow(2, retryCount);
              console.log(`[Service Worker] Rate limited, retrying in ${delay}ms`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            
            throw new Error(errorMessage);
          }
          
          const result = await response.json();
          if (result.text && result.text.trim()) {
            const transcription = {
              userId,
              text: result.text.trim(),
              speaker: this.getSpeakerName(userId),
              timestamp: Date.now()
            };
            this.sendTranscription(transcription, userId);
          }
          return;
        } catch (error) {
          retryCount++;
          if (retryCount === maxRetries) {
            throw error;
          }
          const delay = baseDelay * Math.pow(2, retryCount);
          console.log(`[Service Worker] Transcription failed, retrying in ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    sendTranscription(transcription, userId) {
      // Find the tab ID for this user
      const tabId = Array.from(activeTabs.entries())
        .find(([_, status]) => status.userId === userId)?.[0];
  
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { 
          type: 'transcription', 
          data: transcription 
        }).catch(() => {
          console.log(`[Service Worker] Tab ${tabId} not ready for transcription`);
        });
      }
    }
  
    getSpeakerName(userId) {
      if (this.speakerMap.has(userId)) return this.speakerMap.get(userId);
      return `Speaker-${userId.substring(0, 6).toUpperCase()}`;
    }
    
    createWAV(float32Array, sampleRate) {
      const length = float32Array.length;
      const buffer = new ArrayBuffer(44 + length * 2);
      const view = new DataView(buffer);
  
      const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
      };
      
      writeString(0, 'RIFF'); // RIFF header
      view.setUint32(4, 36 + length * 2, true); // file size
      writeString(8, 'WAVE'); // WAVE header
      writeString(12, 'fmt '); // fmt chunk
      view.setUint32(16, 16, true); // format chunk length
      view.setUint16(20, 1, true);  // sample format (1 for PCM)
      view.setUint16(22, 1, true);  // channel count
      view.setUint32(24, sampleRate, true); // sample rate
      view.setUint32(28, sampleRate * 2, true); // byte rate
      view.setUint16(32, 2, true); // block align
      view.setUint16(34, 16, true); // bits per sample
      writeString(36, 'data'); // data chunk
      view.setUint32(40, length * 2, true); // data size
  
      let offset = 44;
      for (let i = 0; i < length; i++) {
        const sample = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
      
      return new Blob([buffer], { type: 'audio/wav' });
    }

    handleMessageFromOffscreen(request, sender) {
        // We only care about messages from our offscreen document
        if (sender.url?.endsWith('offscreen.html')) {
            if (request.type === 'audio-blob') {
                this.transcribeAudio(request.data.blob, request.data.tabId);
            }
        }
    }

    async transcribeAudio(audioBlob, tabId) {
        if (!this.apiKey) {
            this.showNotification('Transcription Failed', 'OpenAI API key is not set.');
            return;
        }

        const formData = new FormData();
        formData.append('file', audioBlob, 'audio.webm');
        formData.append('model', 'whisper-1');
        formData.append('language', 'en-US');

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: formData
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.statusText}`);
        }

        const result = await response.json();
        if (result.text && result.text.trim()) {
            console.log(`[Tab: ${tabId}] Transcription: `, result.text);
            this.showNotification('Transcription Received', result.text.trim());
        }
    }
  }
  
  // Add click handler for extension icon
  chrome.action.onClicked.addListener(async (tab) => {
    if (tab.url && tab.url.startsWith('https://vtf.t3live.com')) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['dist/content.bundle.js']
        });
        console.log('Content script injected.');
      } catch (err) {
        console.error('Failed to inject content script:', err);
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Injection Error',
          message: 'Failed to initialize the extension. Please reload the page.'
        });
      }
    } else {
      console.log('This extension only works on the VTF page.');
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Invalid Page',
        message: 'This extension only works on the VTF platform.'
      });
    }
  });

  const vtfService = new VTFTranscriptionService();