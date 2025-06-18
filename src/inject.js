// inject.js - Runs in page context to capture real audio
(function() {
  console.log('[VTF Inject] Script loaded in page context');
  
  let audioContext = null;
  let activeProcessors = new Map();
  let capturePaused = false;
  
  // Error handling wrapper
  function withErrorBoundary(fn, context = '') {
    return function(...args) {
      try {
        return fn.apply(this, args);
      } catch (error) {
        console.error(`[VTF Inject] Error in ${context}:`, error);
        // Don't rethrow - keep the extension running
      }
    };
  }
  
  // Audio quality assessment
  function assessAudioQuality(audioData) {
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
    
    return {
      quality: quality,
      rms: rms,
      dynamicRange: dynamicRange,
      maxSample: maxSample
    };
  }
  
  // Function to capture audio from an element
  async function captureAudioElement(audioElement) {
    const streamId = audioElement.id;
    
    if (capturePaused) return;
    if (activeProcessors.has(streamId)) {
      console.log(`[VTF Inject] Already capturing: ${streamId}`);
      return;
    }
    
    console.log(`[VTF Inject] Starting capture for: ${streamId}`);
    
    try {
      // Create audio context if needed
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        console.log(`[VTF Inject] Created AudioContext, state: ${audioContext.state}`);
        
        // Load AudioWorklet module with inline processor code
        try {
          // Check if AudioWorklet is supported
          if (!audioContext.audioWorklet) {
            throw new Error('AudioWorklet not supported by this browser');
          }
          const processorCode = `
// AudioWorklet Processor for VTF Transcriber
class VTFAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.audioBuffer = [];
    this.chunkSize = 16000; // 1 second at 16kHz
    
         // Advanced VAD parameters (recalibrated for VTF environment)
     this.vadConfig = {
       energyThreshold: 0.005,      // Higher RMS energy threshold for cleaner detection
       zcrThreshold: 0.4,           // Zero crossing rate threshold  
       spectralCentroidThreshold: 1000, // Spectral centroid threshold (Hz)
       spectralRolloffThreshold: 2000,  // Spectral rolloff threshold (Hz)
       voiceProbabilityThreshold: 0.6,  // Higher combined probability threshold
       adaptiveWindow: 30,          // Shorter adaptive window for faster adaptation
       hangoverFrames: 1            // Minimal hangover frames to prevent overlaps
     };
     
     // Adaptive thresholding
     this.energyHistory = [];
     this.noiseFloor = 0.01;      // Start with more realistic noise floor
     this.snrHistory = [];
     this.initialized = false;
    
         // Voice activity state
     this.voiceActivity = false;
     this.hangoverCounter = 0;
     this.consecutiveSilentChunks = 0;
     this.maxSilentChunks = 3;
     this.chunkCount = 0;
    
    // Spectral analysis setup
    this.sampleRate = 16000;
    this.fftSize = 512;
    
    // Listen for configuration updates
    this.port.onmessage = (event) => {
      if (event.data.type === 'configure') {
        this.chunkSize = event.data.chunkSize || 16000;
        Object.assign(this.vadConfig, event.data.vadConfig || {});
      }
    };
  }
  
  // Calculate Zero Crossing Rate
  calculateZCR(audioData) {
    let crossings = 0;
    for (let i = 1; i < audioData.length; i++) {
      if ((audioData[i] >= 0) !== (audioData[i - 1] >= 0)) {
        crossings++;
      }
    }
    return crossings / (audioData.length - 1);
  }
  
  // Simple FFT implementation for spectral analysis
  fft(audioData) {
    const N = Math.min(audioData.length, this.fftSize);
    const real = new Array(N);
    const imag = new Array(N);
    
    // Copy audio data and pad with zeros if necessary
    for (let i = 0; i < N; i++) {
      real[i] = i < audioData.length ? audioData[i] : 0;
      imag[i] = 0;
    }
    
    // Simple DFT (not optimized FFT, but sufficient for VAD)
    const magnitude = new Array(N / 2);
    for (let k = 0; k < N / 2; k++) {
      let realSum = 0, imagSum = 0;
      for (let n = 0; n < N; n++) {
        const angle = -2 * Math.PI * k * n / N;
        realSum += real[n] * Math.cos(angle) - imag[n] * Math.sin(angle);
        imagSum += real[n] * Math.sin(angle) + imag[n] * Math.cos(angle);
      }
      magnitude[k] = Math.sqrt(realSum * realSum + imagSum * imagSum);
    }
    
    return magnitude;
  }
  
  // Calculate spectral features
  calculateSpectralFeatures(audioData) {
    const spectrum = this.fft(audioData);
    const totalEnergy = spectrum.reduce((sum, val) => sum + val, 0);
    
    if (totalEnergy === 0) {
      return { centroid: 0, rolloff: 0, spread: 0 };
    }
    
    // Spectral Centroid (brightness)
    let weightedSum = 0;
    for (let i = 0; i < spectrum.length; i++) {
      const freq = i * this.sampleRate / (2 * spectrum.length);
      weightedSum += freq * spectrum[i];
    }
    const centroid = weightedSum / totalEnergy;
    
    // Spectral Rolloff (85% of energy)
    let cumulativeEnergy = 0;
    const rolloffThreshold = 0.85 * totalEnergy;
    let rolloff = 0;
    
    for (let i = 0; i < spectrum.length; i++) {
      cumulativeEnergy += spectrum[i];
      if (cumulativeEnergy >= rolloffThreshold) {
        rolloff = i * this.sampleRate / (2 * spectrum.length);
        break;
      }
    }
    
    // Spectral Spread (bandwidth)
    let spreadSum = 0;
    for (let i = 0; i < spectrum.length; i++) {
      const freq = i * this.sampleRate / (2 * spectrum.length);
      spreadSum += Math.pow(freq - centroid, 2) * spectrum[i];
    }
    const spread = Math.sqrt(spreadSum / totalEnergy);
    
    return { centroid, rolloff, spread };
  }
  
  // Advanced Voice Activity Detection
  performVAD(audioData) {
    // 1. Energy-based detection (RMS)
    const rms = Math.sqrt(audioData.reduce((sum, val) => sum + val * val, 0) / audioData.length);
    const maxSample = Math.max(...audioData.map(Math.abs));
    
    // Update noise floor estimation with better initialization
    this.energyHistory.push(rms);
    if (this.energyHistory.length > this.vadConfig.adaptiveWindow) {
      this.energyHistory.shift();
      
      // Estimate noise floor as 20th percentile of recent energy (more conservative)
      const sortedEnergy = [...this.energyHistory].sort((a, b) => a - b);
      const newNoiseFloor = sortedEnergy[Math.floor(sortedEnergy.length * 0.2)];
      
      // Only update if we have enough history and the new floor is reasonable
      if (this.energyHistory.length >= this.vadConfig.adaptiveWindow && newNoiseFloor > 0.001) {
        this.noiseFloor = Math.max(0.001, newNoiseFloor);
        this.initialized = true;
      }
    }
    
    // Signal-to-noise ratio in dB (proper calculation)
    const snr = rms > 0 && this.noiseFloor > 0 ? 20 * Math.log10(rms / this.noiseFloor) : 0;
    this.snrHistory.push(snr);
    if (this.snrHistory.length > 10) this.snrHistory.shift();
    
    // 2. Zero Crossing Rate
    const zcr = this.calculateZCR(audioData);
    
    // 3. Spectral features
    const spectral = this.calculateSpectralFeatures(audioData);
    
    // 4. Combined decision logic with improved scoring
    let voiceProbability = 0;
    
    // Energy contribution (50% weight) - Primary indicator
    const energyScore = rms > this.vadConfig.energyThreshold ? 
      Math.min(1, (rms - this.vadConfig.energyThreshold) / (0.02 - this.vadConfig.energyThreshold)) : 0;
    voiceProbability += 0.5 * energyScore;
    
    // SNR contribution (25% weight) - Using proper dB scale
    const snrScore = this.initialized && snr > 6 ? Math.min(1, Math.max(0, (snr - 6) / 20)) : 0; // 6-26 dB maps to 0-1
    voiceProbability += 0.25 * snrScore;
    
    // ZCR contribution (15% weight) - Voice has moderate ZCR  
    const zcrScore = zcr > 0.05 && zcr < this.vadConfig.zcrThreshold ? 
      1 - Math.abs(zcr - 0.2) / 0.2 : 0; // Peak at 0.2 ZCR
    voiceProbability += 0.15 * zcrScore;
    
    // Spectral contribution (10% weight) - Less weight due to complexity
    const spectralScore = (
      (spectral.centroid > 200 && spectral.centroid < 4000 ? 
        1 - Math.abs(spectral.centroid - 1000) / 3000 : 0) * 0.6 +
      (spectral.rolloff > 800 && spectral.rolloff < 6000 ? 0.4 : 0)
    );
    voiceProbability += 0.1 * spectralScore;
    
    // Apply hangover for voice activity smoothing
    const currentVoiceActivity = voiceProbability > this.vadConfig.voiceProbabilityThreshold;
    
    if (currentVoiceActivity) {
      this.voiceActivity = true;
      this.hangoverCounter = this.vadConfig.hangoverFrames;
      this.consecutiveSilentChunks = 0;
    } else if (this.hangoverCounter > 0) {
      this.voiceActivity = true;
      this.hangoverCounter--;
    } else {
      this.voiceActivity = false;
      this.consecutiveSilentChunks++;
    }
    
    return {
      isVoice: this.voiceActivity,
      probability: voiceProbability,
      features: {
        rms: rms,
        maxSample: maxSample,
        snr: snr,
        zcr: zcr,
        spectralCentroid: spectral.centroid,
        spectralRolloff: spectral.rolloff,
        spectralSpread: spectral.spread,
        noiseFloor: this.noiseFloor
      },
      quality: this.assessAudioQuality(rms, maxSample, snr)
    };
  }
  
  // Assess overall audio quality (using proper dB SNR)
  assessAudioQuality(rms, maxSample, snr) {
    if (rms > 0.01 && snr > 20 && maxSample > 0.02) {
      return 'excellent';
    } else if (rms > 0.005 && snr > 12 && maxSample > 0.01) {
      return 'good';
    } else if (rms > 0.002 && snr > 6) {
      return 'fair';
    } else {
      return 'poor';
    }
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
    
    // Process when we have enough data (non-overlapping chunks)
    if (this.audioBuffer.length >= this.chunkSize) {
      const chunk = this.audioBuffer.slice(0, this.chunkSize);
      this.audioBuffer = this.audioBuffer.slice(this.chunkSize); // Remove processed samples
      
      // Perform advanced VAD
      const vadResult = this.performVAD(chunk);
      this.chunkCount++;
      
      // Debug first few chunks to help diagnose issues
      if (this.chunkCount <= 5) {
        console.log('[VAD Debug #' + this.chunkCount + '] RMS: ' + vadResult.features.rms.toFixed(6) + ', SNR: ' + vadResult.features.snr.toFixed(1) + 'dB, NoiseFloor: ' + vadResult.features.noiseFloor.toFixed(6) + ', Prob: ' + vadResult.probability.toFixed(3) + ', Voice: ' + vadResult.isVoice);
      }
      
      // Stricter filtering to prevent overlapping chunks
      const shouldSend = vadResult.isVoice && vadResult.probability > 0.5;
      
      if (!shouldSend) {
        return true; // Skip this chunk
      }
      
      // Generate unique timestamp to prevent overlaps
      const timestamp = Math.floor(currentTime * 1000);
      
      // Send audio data to main thread with VAD results
      this.port.postMessage({
        type: 'audioData',
        audioData: chunk,
        timestamp: timestamp,
        chunkId: this.chunkCount, // Add unique chunk identifier
        vadResult: vadResult
      });
    }
    
    return true; // Keep processor alive
  }
}

registerProcessor('vtf-audio-processor', VTFAudioProcessor);
`;
          
          // Test processor code syntax before creating blob
          try {
            new Function(processorCode);
          } catch (syntaxError) {
            console.error('[VTF Inject] Processor code has syntax error:', syntaxError);
            throw new Error('Invalid processor code: ' + syntaxError.message);
          }
          
          const blob = new Blob([processorCode], { type: 'application/javascript' });
          const processorUrl = URL.createObjectURL(blob);
          
          console.log('[VTF Inject] Created processor blob, attempting to load...');
          await audioContext.audioWorklet.addModule(processorUrl);
          console.log('[VTF Inject] AudioWorklet module loaded successfully');
          
          // Clean up blob URL
          URL.revokeObjectURL(processorUrl);
        } catch (workletError) {
          console.error('[VTF Inject] AudioWorklet failed with detailed error:', {
            name: workletError.name,
            message: workletError.message,
            stack: workletError.stack
          });
          console.warn('[VTF Inject] AudioWorklet not supported, falling back to ScriptProcessor:', workletError);
          // Fallback will be handled below
        }
      }
      
      // Ensure context is running (Chrome can auto-suspend after silence)
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      // Get the source - try srcObject first, then element
      let source;
      let channelInfo = {};
      
      if (audioElement.srcObject && audioElement.srcObject instanceof MediaStream) {
        source = audioContext.createMediaStreamSource(audioElement.srcObject);
        console.log('[VTF Inject] Using MediaStream source');
        
        // Extract channel metadata from MediaStream
        const tracks = audioElement.srcObject.getAudioTracks();
        if (tracks.length > 0) {
          const track = tracks[0];
          channelInfo = {
            trackId: track.id,
            trackLabel: track.label,
            trackKind: track.kind,
            trackEnabled: track.enabled,
            streamId: audioElement.srcObject.id
          };
          console.log('[VTF Inject] Channel info:', channelInfo);
        }
      } else {
        if (!audioElement.crossOrigin) {
          audioElement.crossOrigin = 'anonymous';
        }
        source = audioContext.createMediaElementSource(audioElement);
        console.log('[VTF Inject] Using MediaElement source');
        
        // Extract basic element info
        channelInfo = {
          elementSrc: audioElement.src,
          elementId: audioElement.id,
          elementVolume: audioElement.volume
        };
      }
      
      let processor;
      
      // Try to use modern AudioWorklet first
      try {
        processor = new AudioWorkletNode(audioContext, 'vtf-audio-processor');
        
        // Configure the advanced VAD processor
        processor.port.postMessage({
          type: 'configure',
          chunkSize: 16000, // 1 second at 16kHz
          vadConfig: {
            energyThreshold: 0.001,      // RMS energy threshold
            zcrThreshold: 0.3,           // Zero crossing rate threshold
            voiceProbabilityThreshold: 0.6,  // Combined probability threshold
            adaptiveWindow: 50,          // Frames for adaptive thresholding
            hangoverFrames: 5            // Frames to extend voice activity
          }
        });
        
        // Listen for VAD results from the worklet
        processor.port.onmessage = withErrorBoundary((event) => {
          if (event.data.type === 'audioData') {
            const { audioData, timestamp, vadResult } = event.data;
            
            // Debug log with VAD features
            if (window.VTF_DEBUG_CAPTURE) {
              const f = vadResult.features;
              console.debug(`[VTF Inject] VAD chunk (${audioData.length} samples): voice=${vadResult.isVoice}, prob=${vadResult.probability.toFixed(3)}, quality=${vadResult.quality}, rms=${f.rms.toFixed(6)}, snr=${f.snr.toFixed(2)}, zcr=${f.zcr.toFixed(3)}, centroid=${f.spectralCentroid.toFixed(0)}Hz`);
            }
            
            // Send to content script with VAD data
            window.postMessage({
              type: 'VTF_AUDIO_DATA',
              streamId: streamId,
              audioData: audioData,
              timestamp: timestamp,
              vadResult: vadResult,
              channelInfo: channelInfo,
              // Legacy compatibility
              maxSample: vadResult.features.maxSample,
              audioQuality: vadResult.quality,
              rms: vadResult.features.rms,
              isSilent: !vadResult.isVoice
            }, '*');
          }
        }, 'worklet VAD message handling');
        
        console.log('[VTF Inject] Using modern AudioWorklet processor');
        
      } catch (workletError) {
        console.warn('[VTF Inject] AudioWorklet creation failed, using fallback ScriptProcessor:', workletError);
        
        // Fallback to ScriptProcessor for compatibility
        processor = audioContext.createScriptProcessor(4096, 1, 1);
        let audioBuffer = [];
        let chunkCount = 0;
        const CHUNK_SIZE = 16000; // 1 second at 16kHz
        
        processor.onaudioprocess = withErrorBoundary((e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          
          // Always accumulate audio – downstream logic will decide if it is silence
          audioBuffer.push(...inputData);
          
          if (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);
            chunkCount++;
            
            // Assess audio quality
            const qualityInfo = assessAudioQuality(chunk);
            
            // Only send non-silent chunks with reasonable quality
            if (qualityInfo.rms > 0.005 && qualityInfo.quality !== 'poor') {
              // Debug log
              if (window.VTF_DEBUG_CAPTURE) {
                console.debug(`[VTF Inject] Sent audio chunk (${chunk.length} samples), quality=${qualityInfo.quality}, peak=${qualityInfo.maxSample.toFixed(5)}, rms=${qualityInfo.rms.toFixed(6)}`);
              }
              
              // Send to content script via postMessage
              window.postMessage({
                type: 'VTF_AUDIO_DATA',
                streamId: streamId,
                audioData: chunk,
                timestamp: Date.now(),
                chunkId: chunkCount, // Add unique chunk identifier
                channelInfo: channelInfo,
                maxSample: qualityInfo.maxSample,
                audioQuality: qualityInfo.quality,
                rms: qualityInfo.rms,
                isSilent: qualityInfo.rms < 0.005 // Stricter silence detection
              }, '*');
            }
          }
        }, 'audio processing');
      }
      
      // Connect pipeline
      source.connect(processor);
      if (processor.connect) {
        processor.connect(audioContext.destination);
      }
      
      // Store for cleanup
      activeProcessors.set(streamId, {
        source: source,
        processor: processor
      });
      
      console.log('[VTF Inject] Audio pipeline connected');
      
    } catch (error) {
      console.error('[VTF Inject] Error:', error);
    }
  }
  
  // Function to stop capture
  function stopCapture(streamId) {
    const nodes = activeProcessors.get(streamId);
    if (nodes) {
      console.log(`[VTF Inject] Stopping capture for: ${streamId}`);
      try {
        nodes.source.disconnect();
        nodes.processor.disconnect();
      } catch (e) {
        // Ignore
      }
      activeProcessors.delete(streamId);
    }
  }
  
  // Monitor for audio elements with error boundary
  const observer = new MutationObserver(withErrorBoundary((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeName === 'AUDIO' && node.id && node.id.startsWith('msRemAudio-')) {
          console.log(`[VTF Inject] New audio element: ${node.id}`);
          
          // Wait a bit for element to be ready
          setTimeout(() => {
            if (node.srcObject || node.src) {
              captureAudioElement(node);
            }
          }, 500);
          
          // Also capture on play
          node.addEventListener('play', () => {
            captureAudioElement(node);
          });
        }
      });
      
      mutation.removedNodes.forEach((node) => {
        if (node.nodeName === 'AUDIO' && node.id && node.id.startsWith('msRemAudio-')) {
          stopCapture(node.id);
        }
      });
    });
  }, 'mutation observer'));
  
  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Check existing elements
  document.querySelectorAll('audio[id^="msRemAudio-"]').forEach(audio => {
    if (audio.srcObject || audio.src) {
      captureAudioElement(audio);
    }
  });
  
  // Listen for play events
  document.addEventListener('play', (e) => {
    if (e.target.id && e.target.id.startsWith('msRemAudio-')) {
      captureAudioElement(e.target);
    }
  }, true);
  
  // Listen for control messages from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;

    if (event.data.type === 'VTF_STOP_CAPTURE') {
      console.log('[VTF Inject] Stop capture requested');
      capturePaused = true;
      // Disconnect all active processors
      activeProcessors.forEach((_, id) => {
        stopCapture(id);
      });
      if (audioContext && audioContext.state === 'running') {
        audioContext.suspend();
      }
    }

    if (event.data.type === 'VTF_START_CAPTURE') {
      console.log('[VTF Inject] Start capture requested');
      capturePaused = false;
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
      }
      // Re-scan existing audio elements
      document.querySelectorAll('audio[id^="msRemAudio-"]').forEach(audio => {
        if (audio.srcObject || audio.src) {
          captureAudioElement(audio);
        }
      });
    }
  });
  
  console.log('[VTF Inject] Monitoring for audio elements');
})();