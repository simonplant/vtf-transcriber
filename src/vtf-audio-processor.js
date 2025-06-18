// vtf-audio-processor.js - Modern AudioWorklet processor for VTF audio capture

class VTFAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.audioBuffer = [];
    this.chunkSize = 16000; // 1 second at 16kHz
    this.silenceThreshold = 0.001; // RMS threshold for silence detection
    this.consecutiveSilentChunks = 0;
    this.maxSilentChunks = 3; // 3 seconds of silence before pausing
    
    // Listen for messages from main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'configure') {
        this.chunkSize = event.data.chunkSize || 16000;
        this.silenceThreshold = event.data.silenceThreshold || 0.001;
      }
    };
  }
  
  // Assess audio quality and detect silence
  assessAudioQuality(audioData) {
    // Calculate RMS (Root Mean Square) for audio quality assessment
    const rms = Math.sqrt(audioData.reduce((sum, val) => sum + val * val, 0) / audioData.length);
    
    // Assess quality based on RMS and dynamic range
    const maxSample = Math.max(...audioData.map(Math.abs));
    const dynamicRange = maxSample / (rms || 0.0001); // Avoid division by zero
    
    let quality = 'poor';
    if (rms > 0.001 && dynamicRange > 2) {
      quality = 'good';
    } else if (rms > 0.0005 || dynamicRange > 1.5) {
      quality = 'fair';
    }
    
    // Silence detection
    const isSilent = rms < this.silenceThreshold;
    
    return {
      quality: quality,
      rms: rms,
      dynamicRange: dynamicRange,
      maxSample: maxSample,
      isSilent: isSilent
    };
  }
  
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    
    // If no input, return true to keep processor alive
    if (!input || !input[0]) {
      return true;
    }
    
    const inputData = input[0]; // First channel
    
    // Accumulate audio data
    this.audioBuffer.push(...inputData);
    
    // Process when we have enough data
    if (this.audioBuffer.length >= this.chunkSize) {
      const chunk = this.audioBuffer.slice(0, this.chunkSize);
      this.audioBuffer = this.audioBuffer.slice(this.chunkSize);
      
      // Assess audio quality and detect silence
      const qualityInfo = this.assessAudioQuality(chunk);
      
      // Handle silence detection
      if (qualityInfo.isSilent) {
        this.consecutiveSilentChunks++;
        
        // Skip sending silent chunks after threshold
        if (this.consecutiveSilentChunks > this.maxSilentChunks) {
          return true; // Skip this chunk
        }
      } else {
        this.consecutiveSilentChunks = 0;
      }
      
      // Send audio data to main thread
      this.port.postMessage({
        type: 'audioData',
        audioData: chunk,
        timestamp: currentTime * 1000, // Convert to milliseconds
        qualityInfo: qualityInfo
      });
    }
    
    return true; // Keep processor alive
  }
}

registerProcessor('vtf-audio-processor', VTFAudioProcessor); 