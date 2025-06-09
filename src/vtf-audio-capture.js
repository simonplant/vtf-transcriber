export class VTFAudioCapture {
    constructor() {
      this.audioContext = null;
      this.workletReady = false;
      this.captures = new Map();
      this.lastCleanupTime = Date.now();
    }
    
    async initialize() {
      // Prevent creating multiple contexts if re-initialized
      if (this.audioContext && this.audioContext.state !== 'closed') {
        return;
      }
      
      try {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 16000,
          latencyHint: 'interactive'
        });
        
        await this.audioContext.audioWorklet.addModule(
          chrome.runtime.getURL('audio-worklet.js')
        );
        this.workletReady = true;
        console.log('[Audio Capture] AudioWorklet initialized');
      } catch (error) {
        console.warn('[Audio Capture] AudioWorklet failed:', error);
        this.workletReady = false;
        throw error; // Propagate error for recovery
      }
    }
    
    async captureStream(stream, userId) {
      if (!this.workletReady) throw new Error("AudioWorklet is not ready.");
      if (this.captures.has(userId)) return; // Already capturing this user
      
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
      
      // Store all nodes for later cleanup
      this.captures.set(userId, { source, processor, stream }); 
      console.log(`[Audio Capture] Started capture for ${userId}`);
    }

    /**
     * Stops audio capture for a specific user and disconnects their audio nodes.
     * This logic is based on the component specification for stopping individual captures.
     */
    stopCapture(userId) {
      const capture = this.captures.get(userId);
      if (!capture) return;

      console.log(`[Audio Capture] Stopping capture for ${userId}`);
      try {
        // Disconnect all audio nodes to stop processing
        capture.source.disconnect();
        capture.processor.disconnect();
      } catch (error) {
        console.error(`[Audio Capture] Error during node disconnection for ${userId}:`, error);
      }
      
      this.captures.delete(userId); // Remove from active captures map
    }

    /**
     * Stops all active audio captures and closes the AudioContext to free all resources.
     */
    stopAll() {
      console.log('[Audio Capture] Stopping all active captures.');
      // Iterate over all active captures and stop them individually
      this.captures.forEach((capture, userId) => {
        this.stopCapture(userId);
      });

      // Close the master AudioContext to release all associated resources
      if (this.audioContext && this.audioContext.state !== 'closed') {
        this.audioContext.close().then(() => {
          console.log('[Audio Capture] AudioContext closed.');
        });
      }
      // Ensure the captures map is clear
      this.captures.clear();
    }
  }