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
      this.config = { bufferDuration: 1.5, silenceTimeout: 2000 };
      this.apiKey = null;
      this.speakerMap = new Map([
          ['XRcupJu26dK_sazaAAPK', 'DP'],
          ['O3e0pz1234K_cazaAAPK', 'Kira']
      ]);
    }
  
    async init() {
      const storage = await chrome.storage.local.get(['openaiApiKey']);
      this.apiKey = storage.openaiApiKey;
      if (!this.apiKey) console.error('[Service Worker] No API key configured');
  
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'audioChunk') {
          this.handleAudioChunk(request);
        }
        return true;
      });
  
      // Listen for changes to the API key in storage
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.openaiApiKey) {
          this.apiKey = changes.openaiApiKey.newValue;
          console.log('[Service Worker] OpenAI API key updated.');
        }
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
        // Use chrome.notifications API
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Transcription Failed',
          message: 'OpenAI API key is not set. Please set it in the extension popup.'
        });
        throw new Error('No API key configured');
      }
  
      const wavBlob = this.createWAV(new Float32Array(audioData.samples), 16000);
      const formData = new FormData();
      formData.append('file', wavBlob, 'audio.wav');
      formData.append('model', 'whisper-1');
      formData.append('language', 'en');
  
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        body: formData
      });
  
      if (!response.ok) {
        const error = await response.json();
        const errorMessage = error.error?.message || 'Unknown API error';
        // Send a specific error message to the content script's UI
        this.broadcastError({ message: `Whisper API Error: ${errorMessage}` });
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
        this.broadcastTranscription(transcription);
      }
    }
    
    broadcastTranscription(transcription) {
      chrome.tabs.query({ url: '*://vtf.t3live.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { type: 'transcription', data: transcription })
            .catch(() => {}); // Ignore errors if tab is not ready
        });
      });
    }
  
    // New function to broadcast errors to the UI
    broadcastError(errorData) {
      chrome.tabs.query({ url: '*://vtf.t3live.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'transcription-error',
            data: errorData
          }).catch(() => {});
        });
      });
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
    // Ensure we are on the correct VTF page
    if (tab.url && tab.url.startsWith('https://vtf.t3live.com')) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['dist/content.bundle.js']
        });
        console.log('Content script injected.');
      } catch (err) {
        console.error('Failed to inject content script:', err);
      }
    } else {
      console.log('This extension only works on the VTF page.');
    }
  });

  const vtfService = new VTFTranscriptionService();
  vtfService.init();