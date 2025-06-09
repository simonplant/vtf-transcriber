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
  
  // Main service class for the extension background
  class VTFTranscriptionService {
    constructor() {
      this.userBuffers = new Map();
      this.activeTranscriptions = new Map();
      this.activeTabs = new Map();
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
    }
  
    async init() {
      try {
        const storage = await chrome.storage.local.get(['openaiApiKey']);
        this.apiKey = storage.openaiApiKey;
        if (!this.apiKey) {
          console.error('[Service Worker] No API key configured');
          this.showNotification('Configuration Required', 'Please set your OpenAI API key in the extension options.');
        }
  
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
          this.handleMessage(request, sender).then(sendResponse).catch(error => {
            console.error('[Service Worker] Message handling error:', error);
            sendResponse({ error: error.message });
          });
          return true;
        });
  
        // Listen for changes to the API key in storage
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && changes.openaiApiKey) {
            this.apiKey = changes.openaiApiKey.newValue;
            console.log('[Service Worker] OpenAI API key updated.');
            if (this.apiKey) {
              this.showNotification('API Key Updated', 'Your OpenAI API key has been successfully updated.');
            }
          }
        });
  
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
        this.activeTabs.forEach((status, tabId) => {
          if (now - status.lastHeartbeat > this.config.heartbeatTimeout) {
            console.log(`[Service Worker] Tab ${tabId} heartbeat timeout, marking as inactive`);
            this.activeTabs.delete(tabId);
          }
        });
      }, 5000); // Check every 5 seconds
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
        case 'audioChunk':
          this.handleAudioChunk(request);
          return { received: true };
  
        case 'startCapture':
          if (!this.apiKey) {
            throw new Error('OpenAI API key is not configured');
          }
          await chrome.scripting.executeScript({
            target: { tabId: request.tabId },
            files: ['dist/content.bundle.js']
          });
          this.activeTabs.set(request.tabId, { 
            streams: 0,
            lastHeartbeat: Date.now()
          });
          return { started: true };
        
        case 'stopCapture':
          await chrome.tabs.sendMessage(request.tabId, { type: 'stopCapture' });
          this.activeTabs.delete(request.tabId);
          return { stopped: true };
  
        case 'heartbeat':
          if (this.activeTabs.has(sender.tab.id)) {
            const status = this.activeTabs.get(sender.tab.id);
            status.lastHeartbeat = Date.now();
            status.streams = request.data.streamCount;
            this.activeTabs.set(sender.tab.id, status);
          }
          return { received: true };
  
        case 'getStatus':
          const status = this.activeTabs.get(request.tabId);
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
  
    handleAudioChunk(request) {
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
      const tabId = Array.from(this.activeTabs.entries())
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
  vtfService.init();