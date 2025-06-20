/**
 * @file vtf-audio-processor.js
 * @path src/vtf-audio-processor.js
 * @description AudioWorklet processor for capturing, buffering, and performing VAD on audio streams.
 * @modified 2024-07-26
 */

// Enhanced AudioWorklet Processor for VTF with proper thresholds
class VTFAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.audioBuffer = [];
    this.chunkSize = 16000; // 1 second at 16kHz for better context
    
    // Proper VAD parameters for speech detection
    this.vadConfig = {
      energyThreshold: 0.005,          // Increased from 0.003
      zcrThreshold: 0.4,               // Good for speech detection
      spectralCentroidThreshold: 1000, // Speech frequency range
      spectralRolloffThreshold: 2000,  // Speech frequency range  
      voiceProbabilityThreshold: 0.6,  // Increased from 0.5
      adaptiveWindow: 20,              // Reasonable adaptation
      hangoverFrames: 8                // Smooth detection
    };
    
    // Adaptive thresholding
    this.energyHistory = [];
    this.noiseFloor = 0.002;     // Reasonable noise floor
    this.snrHistory = [];
    this.initialized = false;
    
    // Voice activity state
    this.voiceActivity = false;
    this.hangoverCounter = 0;
    this.consecutiveSilentChunks = 0;
    this.chunkCount = 0;
    
    // Spectral analysis setup
    this.sampleRate = 16000;
    this.fftSize = 256;
    
    // Listen for configuration updates
    this.port.onmessage = (event) => {
      if (event.data.type === 'configure') {
        this.chunkSize = event.data.chunkSize || 16000;
        Object.assign(this.vadConfig, event.data.vadConfig || {});
      }
    };
  }
  
  calculateZCR(audioData) {
    let crossings = 0;
    for (let i = 1; i < audioData.length; i++) {
      if ((audioData[i] >= 0) !== (audioData[i - 1] >= 0)) {
        crossings++;
      }
    }
    return crossings / (audioData.length - 1);
  }
  
  // Simplified spectral analysis for performance
  calculateSpectralFeatures(audioData) {
    const N = Math.min(audioData.length, this.fftSize);
    let totalEnergy = 0;
    let weightedSum = 0;
    
    // Simple energy-based spectral centroid calculation
    for (let i = 0; i < N; i++) {
      const energy = audioData[i] * audioData[i];
      totalEnergy += energy;
      weightedSum += i * energy;
    }
    
    const centroid = totalEnergy > 0 ? (weightedSum / totalEnergy) * (this.sampleRate / 2 / N) : 0;
    
    return { centroid, rolloff: centroid * 1.5 };
  }
  
  // Proper VAD with reasonable thresholds
  performVAD(audioData) {
    const rms = Math.sqrt(audioData.reduce((sum, val) => sum + val * val, 0) / audioData.length);
    const maxSample = Math.max(...audioData.map(Math.abs));
    
    // Update energy history
    this.energyHistory.push(rms);
    if (this.energyHistory.length > this.vadConfig.adaptiveWindow) {
      this.energyHistory.shift();
    }
    
    // Initialize noise floor
    if (!this.initialized && this.energyHistory.length >= 5) {
      const sortedEnergy = [...this.energyHistory].sort((a, b) => a - b);
      this.noiseFloor = Math.max(0.001, sortedEnergy[0] * 1.5); // Reasonable noise floor
      this.initialized = true;
    }
    
    const zcr = this.calculateZCR(audioData);
    const spectralFeatures = this.calculateSpectralFeatures(audioData);
    const snr = this.noiseFloor > 0 ? 20 * Math.log10(rms / this.noiseFloor) : 0;
    
    this.snrHistory.push(snr);
    if (this.snrHistory.length > 5) this.snrHistory.shift();
    const avgSNR = this.snrHistory.reduce((a, b) => a + b, 0) / this.snrHistory.length;
    
    // Multi-feature voice activity decision
    let voiceProbability = 0;
    
    // Energy criterion
    if (rms > this.vadConfig.energyThreshold) voiceProbability += 0.3;
    if (rms > this.vadConfig.energyThreshold * 2) voiceProbability += 0.2;
    
    // ZCR criterion (voice typically has lower ZCR)
    if (zcr < this.vadConfig.zcrThreshold) voiceProbability += 0.2;
    
    // Spectral features
    if (spectralFeatures.centroid > this.vadConfig.spectralCentroidThreshold) voiceProbability += 0.15;
    
    // SNR criterion
    if (avgSNR > 6) voiceProbability += 0.15; // Reasonable SNR threshold
    
    // Dynamic range check
    const dynamicRange = maxSample / (rms || 0.0001);
    if (dynamicRange > 2) voiceProbability += 0.1;
    
    // Decision logic with hangover
    const isVoiceCandidate = voiceProbability >= this.vadConfig.voiceProbabilityThreshold;
    
    if (isVoiceCandidate) {
      this.voiceActivity = true;
      this.hangoverCounter = this.vadConfig.hangoverFrames;
    } else {
      if (this.hangoverCounter > 0) {
        this.hangoverCounter--;
        this.voiceActivity = true;
      } else {
        this.voiceActivity = false;
      }
    }
    
    // Quality assessment
    let quality = 'poor';
    if (rms > 0.005 && maxSample < 0.95) {
      quality = avgSNR > 10 ? 'good' : 'fair';
    } else if (rms > 0.002) {
      quality = 'fair';
    }

    return {
        isVoice: this.voiceActivity,
        probability: voiceProbability,
        features: {
            rms: rms,
            zcr: zcr,
            snr: snr,
            spectralCentroid: spectralFeatures.centroid,
            maxAmplitude: maxSample,
        },
        quality: quality,
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length === 0) {
      return true;
    }
    
    // Assuming mono, down-sample if necessary (browser resamples to audioContext.sampleRate)
    const audioData = input[0];
    this.audioBuffer.push(...audioData);
    
    // Process in chunks
    while (this.audioBuffer.length >= this.chunkSize) {
      const chunk = this.audioBuffer.splice(0, this.chunkSize);
      const vadResult = this.performVAD(chunk);
      
      // Send chunk and VAD result back to the main thread
      this.port.postMessage({
        type: 'audioData',
        audioData: chunk,
        vadResult: vadResult,
        timestamp: Date.now()
      });
    }
    
    return true;
  }
}

registerProcessor('vtf-audio-processor', VTFAudioProcessor); 