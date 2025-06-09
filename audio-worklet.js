class VTFAudioProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.userId = options.processorOptions.userId;
      this.bufferSize = 4096;
      this.buffer = [];
    }
    
    process(inputs, outputs, parameters) {
      const input = inputs[0];
      if (input && input.length > 0) {
        const channelData = input[0];
        if (channelData) this.buffer.push(...channelData);
        
        while (this.buffer.length >= this.bufferSize) {
          const chunk = this.buffer.splice(0, this.bufferSize);
          
          // Basic silence detection
          const maxSample = Math.max(...chunk.map(Math.abs));
          if (maxSample > 0.001) {
            this.port.postMessage({ samples: chunk, userId: this.userId });
          }
        }
      }
      return true; // Keep processor alive
    }
  }
  
  registerProcessor('vtf-audio-processor', VTFAudioProcessor);