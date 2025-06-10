// content.js - VTF Audio Extension with enhanced debugging and visual feedback
// Simplified version that works with inject.js

console.log('VTF Audio Extension: Content script loaded at', new Date().toISOString());

// Inject the page-context script
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
script.onload = function() {
  console.log('VTF Audio Extension: Inject script loaded');
  this.remove();
};
(document.head || document.documentElement).appendChild(script);

// Keep track of audio chunks sent
let chunksSent = 0;
let lastTranscripts = new Map(); // Track last transcript per speaker for merging

// Listen for audio data from inject script
window.addEventListener('message', (event) => {
  // Only accept messages from the same window
  if (event.source !== window) return;
  
  if (event.data && event.data.type === 'VTF_AUDIO_DATA') {
    console.log(`[Content] Received audio data from inject script: ${event.data.audioData.length} samples, max: ${event.data.maxSample}`);
    
    chunksSent++;
    console.log(`[Content] Sending chunk #${chunksSent} to background...`);
    
    // Check if extension context is still valid
    try {
      // Send to background script
      chrome.runtime.sendMessage({
        type: 'audioData',
        audioData: event.data.audioData,
        timestamp: event.data.timestamp,
        streamId: event.data.streamId,
        chunkNumber: chunksSent
      }, response => {
        if (chrome.runtime.lastError) {
          console.error('[Content] Error sending audio data:', chrome.runtime.lastError);
          
          // Check if extension was reloaded
          if (chrome.runtime.lastError.message.includes('context invalidated')) {
            console.warn('[Content] Extension was reloaded. Reload the page to reconnect.');
            showReloadNotification();
          }
        } else {
          console.log(`[Content] Audio chunk #${chunksSent} sent successfully, response:`, response);
        }
      });
    } catch (error) {
      console.error('[Content] Failed to send message:', error);
      if (error.message.includes('context invalidated')) {
        showReloadNotification();
      }
    }
  }
});

// Show reload notification
function showReloadNotification() {
  // Check if notification already exists
  if (document.getElementById('vtf-reload-notification')) return;
  
  const notification = document.createElement('div');
  notification.id = 'vtf-reload-notification';
  notification.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(231, 76, 60, 0.95);
    color: white;
    padding: 20px 30px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 16px;
    z-index: 10002;
    text-align: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  `;
  
  notification.innerHTML = `
    <div style="margin-bottom: 15px;">
      <strong>VTF Extension Updated</strong>
    </div>
    <div style="margin-bottom: 15px; font-size: 14px;">
      The extension was reloaded. Please refresh the page to reconnect.
    </div>
    <button onclick="location.reload()" style="
      background: white;
      color: #e74c3c;
      border: none;
      padding: 8px 20px;
      border-radius: 4px;
      font-size: 14px;
      cursor: pointer;
      font-weight: 500;
    ">Refresh Page</button>
  `;
  
  document.body.appendChild(notification);
}

// Check if runtime is available
function isExtensionValid() {
  try {
    return chrome.runtime && chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Check if extension context is still valid
  if (!isExtensionValid()) {
    console.warn('[Content] Extension context invalid, ignoring message');
    return false;
  }
  
  console.log('[Content] Received message:', request);
  
  try {
    if (request.action === 'startManualCapture' || request.type === 'start_capture') {
      console.log('[Content] Manual capture start requested');
      // The inject script is already monitoring, just acknowledge
      sendResponse({status: 'started', timestamp: Date.now()});
      return false; // Synchronous response
    }
    
    if (request.action === 'stopManualCapture' || request.type === 'stop_capture') {
      console.log('[Content] Manual capture stop requested');
      // Could implement a way to pause inject script if needed
      sendResponse({status: 'stopped', timestamp: Date.now()});
      return false; // Synchronous response
    }
    
    if (request.type === 'newTranscription') {
      console.log(`[Content] New transcription received: "${request.transcription.text}"`);
      console.log(`[Transcription ${new Date(request.transcription.timestamp).toLocaleTimeString()}]: ${request.transcription.text}`);
      displayTranscription(request.transcription, request.merged);
      // Send acknowledgment
      sendResponse({received: true});
      return false; // Synchronous response
    }
    
    if (request.type === 'buffer_status') {
      updateBufferStatus(request);
      // Send acknowledgment
      sendResponse({received: true});
      return false; // Synchronous response
    }
    
    // For any unhandled message types
    sendResponse({received: true, handled: false});
    return false; // Synchronous response
    
  } catch (error) {
    console.error('[Content] Error handling message:', error);
    if (error.message.includes('context invalidated')) {
      showReloadNotification();
    }
    return false;
  }
});

// Create floating transcription display with enhanced features
function createTranscriptionDisplay() {
  if (document.getElementById('vtf-transcription-display')) return;
  
  const display = document.createElement('div');
  display.id = 'vtf-transcription-display';
  display.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 450px;
    max-height: 350px;
    background: rgba(0, 0, 0, 0.95);
    color: white;
    padding: 0;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    overflow: hidden;
    z-index: 10000;
    display: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.1);
  `;
  
  // Header with status indicators
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 12px 15px;
    background: rgba(255, 255, 255, 0.05);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;
  
  header.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px;">
      <span style="font-weight: 600; font-size: 14px;">VTF Transcriptions</span>
      <div id="vtf-processing-indicator" style="
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #4CAF50;
        display: none;
        animation: pulse 1.5s infinite;
      "></div>
    </div>
    <div style="display: flex; gap: 15px; font-size: 11px; color: #888;">
      <span>Chunks: <span id="vtf-chunks-sent" style="color: #4CAF50;">0</span></span>
      <span>Buffer: <span id="vtf-buffer-size" style="color: #2196F3;">0.0s</span></span>
      <span id="vtf-activity-level" style="
        padding: 2px 6px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.1);
        color: #888;
      ">Idle</span>
    </div>
  `;
  display.appendChild(header);
  
  // Speaker buffers visualization
  const bufferViz = document.createElement('div');
  bufferViz.id = 'vtf-buffer-viz';
  bufferViz.style.cssText = `
    padding: 8px 15px;
    background: rgba(255, 255, 255, 0.02);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    display: none;
    font-size: 11px;
  `;
  display.appendChild(bufferViz);
  
  // Content area
  const contentWrapper = document.createElement('div');
  contentWrapper.style.cssText = `
    max-height: 250px;
    overflow-y: auto;
    padding: 10px 15px;
  `;
  
  const content = document.createElement('div');
  content.id = 'vtf-transcription-content';
  contentWrapper.appendChild(content);
  display.appendChild(contentWrapper);
  
  // Add styles for animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse {
      0% { opacity: 1; }
      50% { opacity: 0.3; }
      100% { opacity: 1; }
    }
    
    #vtf-transcription-display::-webkit-scrollbar {
      width: 6px;
    }
    
    #vtf-transcription-display ::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.05);
    }
    
    #vtf-transcription-display ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 3px;
    }
    
    #vtf-transcription-display ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.3);
    }
    
    .vtf-transcript-entry {
      margin-bottom: 12px;
      padding: 8px 10px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
      border-left: 3px solid transparent;
      transition: all 0.2s ease;
    }
    
    .vtf-transcript-entry:hover {
      background: rgba(255, 255, 255, 0.08);
    }
    
    .vtf-transcript-entry.merged {
      border-left-color: #2196F3;
    }
    
    .vtf-transcript-entry.new {
      animation: fadeIn 0.3s ease;
    }
    
    @keyframes fadeIn {
      from { 
        opacity: 0;
        transform: translateY(10px);
      }
      to { 
        opacity: 1;
        transform: translateY(0);
      }
    }
  `;
  document.head.appendChild(style);
  
  document.body.appendChild(display);
}

// Display transcription with merge handling
function displayTranscription(transcription, merged = false) {
  createTranscriptionDisplay();
  
  const display = document.getElementById('vtf-transcription-display');
  const content = document.getElementById('vtf-transcription-content');
  const chunksElement = document.getElementById('vtf-chunks-sent');
  
  if (display && content) {
    display.style.display = 'block';
    
    // Update chunks sent counter
    if (chunksElement) {
      chunksElement.textContent = chunksSent;
    }
    
    const streamId = transcription.streamId || 'unknown';
    const speakerName = streamId.split('-')[1] || 'Unknown';
    
    if (merged && lastTranscripts.has(streamId)) {
      // Update existing transcript
      const lastEntry = lastTranscripts.get(streamId);
      if (lastEntry && lastEntry.element && lastEntry.element.parentNode) {
        const textElement = lastEntry.element.querySelector('.vtf-transcript-text');
        if (textElement) {
          // Append to existing text instead of replacing
          textElement.textContent += ' ' + transcription.text;
          lastEntry.element.classList.add('merged');
          
          // Update timestamp
          lastEntry.timestamp = transcription.timestamp;
          
          // Flash animation
          lastEntry.element.style.animation = 'none';
          setTimeout(() => {
            lastEntry.element.style.animation = 'fadeIn 0.3s ease';
          }, 10);
        }
      } else {
        // Element was removed, create new one
        merged = false;
      }
    }
    
    if (!merged) {
      // Create new entry
      const entry = document.createElement('div');
      entry.className = 'vtf-transcript-entry new';
      
      const time = new Date(transcription.timestamp).toLocaleTimeString();
      const duration = transcription.duration ? `(${transcription.duration.toFixed(1)}s)` : '';
      
      entry.innerHTML = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span style="color: #888; font-size: 11px;">${time}</span>
          <span style="color: #4CAF50; font-size: 11px; font-weight: 500;">${speakerName} ${duration}</span>
        </div>
        <div class="vtf-transcript-text" style="color: #fff; line-height: 1.4;">${transcription.text}</div>
      `;
      
      content.insertBefore(entry, content.firstChild);
      
      // Store reference for potential merging
      lastTranscripts.set(streamId, {
        element: entry,
        timestamp: transcription.timestamp
      });
      
      // Keep only last 50 transcriptions in display
      while (content.children.length > 50) {
        const removed = content.removeChild(content.lastChild);
        // Clean up stored references
        lastTranscripts.forEach((value, key) => {
          if (value.element === removed) {
            lastTranscripts.delete(key);
          }
        });
      }
    }
    
    // Scroll to top (newest content)
    content.parentElement.scrollTop = 0;
  }
}

// Update buffer status visualization
function updateBufferStatus(status) {
  // Make sure the display exists first
  if (!document.getElementById('vtf-transcription-display')) {
    createTranscriptionDisplay();
  }
  
  const processingIndicator = document.getElementById('vtf-processing-indicator');
  const bufferSizeElement = document.getElementById('vtf-buffer-size');
  const activityElement = document.getElementById('vtf-activity-level');
  const bufferViz = document.getElementById('vtf-buffer-viz');
  
  if (processingIndicator) {
    processingIndicator.style.display = status.isProcessing ? 'block' : 'none';
  }
  
  if (bufferSizeElement) {
    bufferSizeElement.textContent = `${status.bufferSeconds.toFixed(1)}s`;
    bufferSizeElement.style.color = status.bufferSeconds > 5 ? '#FF9800' : '#2196F3';
  }
  
  if (activityElement) {
    let activityText = 'Idle';
    let activityColor = '#888';
    
    switch (status.activityLevel) {
      case 'high':
        activityText = 'Active';
        activityColor = '#4CAF50';
        break;
      case 'low':
        activityText = 'Low';
        activityColor = '#2196F3';
        break;
    }
    
    activityElement.textContent = activityText;
    activityElement.style.color = activityColor;
    activityElement.style.background = status.activityLevel === 'high' ? 
      'rgba(76, 175, 80, 0.2)' : 'rgba(255, 255, 255, 0.1)';
  }
  
  // Show speaker buffers if multiple speakers
  if (bufferViz && status.speakerBuffers && Object.keys(status.speakerBuffers).length > 1) {
    bufferViz.style.display = 'block';
    const bufferInfo = Object.entries(status.speakerBuffers)
      .filter(([_, duration]) => duration > 0)
      .map(([streamId, duration]) => {
        const speaker = streamId.split('-')[1] || 'Unknown';
        return `<span style="margin-right: 10px;">${speaker}: ${duration.toFixed(1)}s</span>`;
      })
      .join('');
    
    bufferViz.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="color: #666;">Buffers:</span>
        ${bufferInfo}
        <span style="color: #666; margin-left: auto;">Chunk: ${status.adaptiveChunkSize}s</span>
      </div>
    `;
  } else if (bufferViz) {
    bufferViz.style.display = 'none';
  }
}

// Auto-start capture when page loads
window.addEventListener('load', () => {
  console.log('VTF Audio Extension: Page loaded, checking if should auto-start...');
  
  // Check if extension is still valid
  if (!isExtensionValid()) {
    console.warn('[Content] Extension context invalid on load');
    return;
  }
  
  // Check if auto-start is enabled (default: true)
  try {
    chrome.storage.local.get(['settings'], (result) => {
      if (chrome.runtime.lastError) {
        console.error('[Content] Error reading settings:', chrome.runtime.lastError);
        return;
      }
      
      const autoStart = result.settings?.autoStart !== false;
      
      if (autoStart) {
        // Notify background to start capturing
        chrome.runtime.sendMessage({
          type: 'startCapture'
        }, response => {
          if (chrome.runtime.lastError) {
            console.error('[Content] Auto-start error:', chrome.runtime.lastError);
            if (chrome.runtime.lastError.message.includes('context invalidated')) {
              // Extension was reloaded, don't show notification on fresh load
              console.log('[Content] Extension recently reloaded, skipping auto-start');
            }
          } else {
            console.log('[Content] Auto-start successful');
            
            // Show notification that capture started
            const notification = document.createElement('div');
            notification.style.cssText = `
              position: fixed;
              top: 20px;
              left: 50%;
              transform: translateX(-50%);
              background: rgba(76, 175, 80, 0.9);
              color: white;
              padding: 10px 20px;
              border-radius: 4px;
              font-family: -apple-system, BlinkMacSystemFont, sans-serif;
              font-size: 14px;
              z-index: 10001;
              animation: slideDown 0.3s ease;
            `;
            notification.textContent = '🎙️ VTF Audio Transcription Started';
            document.body.appendChild(notification);
            
            setTimeout(() => notification.remove(), 3000);
          }
        });
      }
    });
  } catch (error) {
    console.error('[Content] Error in auto-start:', error);
  }
});

console.log('VTF Audio Extension: Ready and listening for audio...');