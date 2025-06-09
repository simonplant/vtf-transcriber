export class VTFAudioCapture {
    constructor() {
      this.audioContext = null;
      this.workletReady = false;
      this.captures = new Map();
    }
    
    async initialize() {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
        latencyHint: 'interactive'
      });
      try {
        await this.audioContext.audioWorklet.addModule(chrome.runtime.getURL('audio-worklet.js'));
        this.workletReady = true;
        console.log('[Audio Capture] AudioWorklet initialized');
      } catch (error) {
        console.warn('[Audio Capture] AudioWorklet failed, using fallback:', error);
        this.workletReady = false;
      }
    }
    
    async captureStream(stream, userId) {
      if (!this.workletReady) throw new Error("AudioWorklet is not ready.");
      
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) throw new Error('No audio tracks in stream');
      
      const source = this.audioContext.createMediaStreamSource(stream);
      const processor = new AudioWorkletNode(this.audioContext, 'vtf-audio-processor', {
        processorOptions: { userId }
      });
      
      processor.port.onmessage = (event) => {
        chrome.runtime.sendMessage({
          type: 'audioChunk',
          userId: event.data.userId,
          chunk: event.data.samples,
        });
      };
      
      source.connect(processor).connect(this.audioContext.destination);
      this.captures.set(userId, { source, processor });
    }
  }