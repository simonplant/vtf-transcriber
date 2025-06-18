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
        
        // Load AudioWorklet module
        try {
          await audioContext.audioWorklet.addModule(chrome.runtime.getURL('vtf-audio-processor.js'));
          console.log('[VTF Inject] AudioWorklet module loaded');
        } catch (workletError) {
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
      if (audioElement.srcObject && audioElement.srcObject instanceof MediaStream) {
        source = audioContext.createMediaStreamSource(audioElement.srcObject);
        console.log('[VTF Inject] Using MediaStream source');
      } else {
        if (!audioElement.crossOrigin) {
          audioElement.crossOrigin = 'anonymous';
        }
        source = audioContext.createMediaElementSource(audioElement);
        console.log('[VTF Inject] Using MediaElement source');
      }
      
      let processor;
      
      // Try to use modern AudioWorklet first
      try {
        processor = new AudioWorkletNode(audioContext, 'vtf-audio-processor');
        
        // Configure the processor
        processor.port.postMessage({
          type: 'configure',
          chunkSize: 16000, // 1 second at 16kHz
          silenceThreshold: 0.01
        });
        
        // Listen for audio data from the worklet
        processor.port.onmessage = withErrorBoundary((event) => {
          if (event.data.type === 'audioData') {
            const { audioData, timestamp, qualityInfo } = event.data;
            
            // Debug log
            if (window.VTF_DEBUG_CAPTURE) {
              console.debug(`[VTF Inject] Received audio chunk (${audioData.length} samples), quality=${qualityInfo.quality}, peak=${qualityInfo.maxSample.toFixed(5)}, rms=${qualityInfo.rms.toFixed(6)}, silent=${qualityInfo.isSilent}`);
            }
            
            // Send to content script via postMessage
            window.postMessage({
              type: 'VTF_AUDIO_DATA',
              streamId: streamId,
              audioData: audioData,
              timestamp: timestamp,
              maxSample: qualityInfo.maxSample,
              audioQuality: qualityInfo.quality,
              rms: qualityInfo.rms,
              isSilent: qualityInfo.isSilent
            }, '*');
          }
        }, 'worklet message handling');
        
        console.log('[VTF Inject] Using modern AudioWorklet processor');
        
      } catch (workletError) {
        console.warn('[VTF Inject] AudioWorklet creation failed, using fallback ScriptProcessor:', workletError);
        
        // Fallback to ScriptProcessor for compatibility
        processor = audioContext.createScriptProcessor(4096, 1, 1);
        let audioBuffer = [];
        const CHUNK_SIZE = 16000; // 1 second at 16kHz
        
        processor.onaudioprocess = withErrorBoundary((e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          
          // Always accumulate audio – downstream logic will decide if it is silence
          audioBuffer.push(...inputData);
          
          if (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);
            
            // Assess audio quality
            const qualityInfo = assessAudioQuality(chunk);
            
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
              maxSample: qualityInfo.maxSample,
              audioQuality: qualityInfo.quality,
              rms: qualityInfo.rms,
              isSilent: qualityInfo.rms < 0.01 // Simple silence detection for fallback
            }, '*');
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