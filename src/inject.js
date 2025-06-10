// inject.js - Runs in page context to capture real audio
(function() {
  console.log('[VTF Inject] Script loaded in page context');
  
  let audioContext = null;
  let activeProcessors = new Map();
  
  // Function to capture audio from an element
  function captureAudioElement(audioElement) {
    const streamId = audioElement.id;
    
    if (activeProcessors.has(streamId)) {
      console.log(`[VTF Inject] Already capturing: ${streamId}`);
      return;
    }
    
    console.log(`[VTF Inject] Starting capture for: ${streamId}`);
    
    try {
      // Create audio context if needed
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 16000
        });
        console.log(`[VTF Inject] Created AudioContext, state: ${audioContext.state}`);
      }
      
      // Get the source - try srcObject first, then element
      let source;
      if (audioElement.srcObject && audioElement.srcObject instanceof MediaStream) {
        source = audioContext.createMediaStreamSource(audioElement.srcObject);
        console.log('[VTF Inject] Using MediaStream source');
      } else {
        source = audioContext.createMediaElementSource(audioElement);
        console.log('[VTF Inject] Using MediaElement source');
      }
      
      // Create processor
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      let audioBuffer = [];
      const CHUNK_SIZE = 16000; // 1 second at 16kHz
      
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const maxSample = Math.max(...inputData.map(Math.abs));
        
        // Only process if we have real audio
        if (maxSample > 0.001) {
          audioBuffer.push(...inputData);
          
          if (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);
            
            console.log(`[VTF Inject] Sending audio chunk, max sample: ${maxSample}`);
            
            // Send to content script via postMessage
            window.postMessage({
              type: 'VTF_AUDIO_DATA',
              streamId: streamId,
              audioData: chunk,
              timestamp: Date.now(),
              maxSample: maxSample
            }, '*');
          }
        }
      };
      
      // Connect pipeline
      source.connect(processor);
      processor.connect(audioContext.destination);
      
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
  
  // Monitor for audio elements
  const observer = new MutationObserver((mutations) => {
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
  });
  
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
  
  console.log('[VTF Inject] Monitoring for audio elements');
})();