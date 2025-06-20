/**
 * @file vtf-audio-processor.js
 * @path src/vtf-audio-processor.js
 * @description AudioWorklet processor for capturing, buffering, and performing VAD on audio streams.
 * @modified 2024-07-26
 */

// Enhanced AudioWorklet Processor for VTF with optimized thresholds
class VTFAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.audioBuffer = [];
    this.chunkSize = 16000; // 1 second at 16kHz for better context
    
    // Optimized VAD parameters for DP + quick updates from others
    this.vadConfig = {
      energyThreshold: 0.0015,          // Low threshold to catch DP at distance
      zcrThreshold: 0.4,                // Good for speech detection
      spectralCentroidThreshold: 1000,  // Speech frequency range
      spectralRolloffThreshold: 2000,   // Speech frequency range  
      voiceProbabilityThreshold: 0.45,  // Forgiving for DP's distance
      adaptiveWindow: 20,               // Adaptive settings
      hangoverFrames: 10,               // Increased from 8 for better continuity
      minSpeechDuration: 0.2,           // Catches "FLAT!" but ignores clicks
      spectralFluxThreshold: 0.1,       // For speech/music discrimination
      preEmphasisCoeff: 0.97            // Pre-emphasis coefficient for speech enhancement
    };
    
    // Enhanced adaptive thresholding
    this.energyHistory = [];
    this.noiseFloor = 0.001;     // Reduced from 0.002 for better sensitivity
    this.snrHistory = [];
    this.initialized = false;
    this.calibrationFrames = 0;
    this.maxCalibrationFrames = 50; // Calibrate over ~3 seconds
    
    // Voice activity state
    this.voiceActivity = false;
    this.hangoverCounter = 0;
    this.consecutiveSilentChunks = 0;
    this.chunkCount = 0;
    this.speechStartTime = 0;
    
    // Enhanced spectral analysis setup
    this.sampleRate = 16000;
    this.fftSize = 1024; // Increased from 256 for better frequency resolution
    
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
  
  // Apply pre-emphasis filter for speech enhancement
  applyPreEmphasis(audioData) {
    const result = new Float32Array(audioData.length);
    result[0] = audioData[0];
    for (let i = 1; i < audioData.length; i++) {
      result[i] = audioData[i] - this.vadConfig.preEmphasisCoeff * audioData[i - 1];
    }
    return result;
  }
  
  // Enhanced spectral analysis with better resolution
  calculateSpectralFeatures(audioData) {
    const N = Math.min(audioData.length, this.fftSize);
    let totalEnergy = 0;
    let weightedSum = 0;
    let spectralFlux = 0;
    
    // Simple energy-based spectral centroid calculation with better resolution
    for (let i = 0; i < N; i++) {
      const energy = audioData[i] * audioData[i];
      totalEnergy += energy;
      weightedSum += i * energy;
    }
    
    const centroid = totalEnergy > 0 ? (weightedSum / totalEnergy) * (this.sampleRate / 2 / N) : 0;
    
    // Calculate spectral flux (simplified)
    if (this.previousSpectrum) {
      for (let i = 0; i < Math.min(N, this.previousSpectrum.length); i++) {
        const currentEnergy = audioData[i] * audioData[i];
        spectralFlux += Math.abs(currentEnergy - this.previousSpectrum[i]);
      }
      spectralFlux /= N;
    }
    
    // Store current spectrum for next calculation
    this.previousSpectrum = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.previousSpectrum[i] = audioData[i] * audioData[i];
    }
    
    return { 
      centroid, 
      rolloff: centroid * 1.5,
      spectralFlux: spectralFlux || 0
    };
  }
  
  // Enhanced VAD with better thresholds and adaptive noise floor
  performVAD(audioData) {
    // Apply pre-emphasis filter
    const enhancedAudio = this.applyPreEmphasis(audioData);
    
    const rms = Math.sqrt(enhancedAudio.reduce((sum, val) => sum + val * val, 0) / enhancedAudio.length);
    const maxSample = Math.max(...enhancedAudio.map(Math.abs));
    
    // Update energy history
    this.energyHistory.push(rms);
    if (this.energyHistory.length > this.vadConfig.adaptiveWindow) {
      this.energyHistory.shift();
    }
    
    // Enhanced noise floor calibration
    if (!this.initialized && this.calibrationFrames < this.maxCalibrationFrames) {
      this.calibrationFrames++;
      if (this.calibrationFrames >= this.maxCalibrationFrames) {
        const sortedEnergy = [...this.energyHistory].sort((a, b) => a - b);
        // Use 10th percentile for noise floor estimation
        const percentile10 = Math.floor(sortedEnergy.length * 0.1);
        this.noiseFloor = Math.max(0.0005, sortedEnergy[percentile10] * 1.2);
        this.initialized = true;
        console.log(`[VAD] Noise floor calibrated: ${this.noiseFloor.toFixed(6)}`);
      }
    }
    
    const zcr = this.calculateZCR(enhancedAudio);
    const spectralFeatures = this.calculateSpectralFeatures(enhancedAudio);
    const snr = this.noiseFloor > 0 ? 20 * Math.log10(rms / this.noiseFloor) : 0;
    
    this.snrHistory.push(snr);
    if (this.snrHistory.length > 5) this.snrHistory.shift();
    const avgSNR = this.snrHistory.reduce((a, b) => a + b, 0) / this.snrHistory.length;
    
    // Enhanced multi-feature voice activity decision
    let voiceProbability = 0;
    
    // Energy criterion with adaptive threshold
    const adaptiveEnergyThreshold = this.noiseFloor * 3; // 3x noise floor
    if (rms > adaptiveEnergyThreshold) voiceProbability += 0.25;
    if (rms > adaptiveEnergyThreshold * 2) voiceProbability += 0.15;
    
    // ZCR criterion (voice typically has lower ZCR)
    if (zcr < this.vadConfig.zcrThreshold) voiceProbability += 0.2;
    
    // Spectral features
    if (spectralFeatures.centroid > this.vadConfig.spectralCentroidThreshold) voiceProbability += 0.15;
    
    // SNR criterion with adaptive threshold
    const adaptiveSNRThreshold = Math.max(3, avgSNR * 0.5); // Adaptive SNR threshold
    if (avgSNR > adaptiveSNRThreshold) voiceProbability += 0.15;
    
    // Spectral flux for speech/music discrimination
    if (spectralFeatures.spectralFlux > this.vadConfig.spectralFluxThreshold) voiceProbability += 0.1;
    
    // Dynamic range check
    const dynamicRange = maxSample / (rms || 0.0001);
    if (dynamicRange > 2) voiceProbability += 0.1;
    
    // Decision logic with hangover and minimum speech duration
    const isVoiceCandidate = voiceProbability >= this.vadConfig.voiceProbabilityThreshold;
    
    if (isVoiceCandidate) {
      if (!this.voiceActivity) {
        this.speechStartTime = Date.now();
      }
      this.voiceActivity = true;
      this.hangoverCounter = this.vadConfig.hangoverFrames;
    } else {
      if (this.hangoverCounter > 0) {
        this.hangoverCounter--;
        this.voiceActivity = true;
      } else {
        // Check minimum speech duration
        if (this.voiceActivity) {
          const speechDuration = (Date.now() - this.speechStartTime) / 1000;
          if (speechDuration < this.vadConfig.minSpeechDuration) {
            // Keep voice activity true for minimum duration
            this.voiceActivity = true;
          } else {
            this.voiceActivity = false;
          }
        } else {
          this.voiceActivity = false;
        }
      }
    }
    
    // Enhanced quality assessment with optimized thresholds for DP + others
    let quality = 'poor';
    if (rms > 0.003 && maxSample < 0.9) { // Safe for Rick's volume
      quality = avgSNR > 8 ? 'good' : 'fair'; // Reduced SNR threshold
    } else if (rms > 0.001) {
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
            spectralFlux: spectralFeatures.spectralFlux,
            maxAmplitude: maxSample,
            noiseFloor: this.noiseFloor,
            adaptiveThreshold: adaptiveEnergyThreshold
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