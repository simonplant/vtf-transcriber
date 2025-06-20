/**
 * @file content.js
 * @path src/content.js
 * @description VTF platform integration script handling message routing and transcription display
 * @modified 2025-06-18
 */

// content.js - VTF Audio Extension with enhanced debugging and visual feedback
// Simplified version that works with inject.js

console.log('VTF Audio Extension: Content script loaded at', new Date().toISOString());

// --- FIX: Consolidated message listener ---
window.addEventListener('message', (event) => {
  // Basic validation for all incoming messages
  if (event.source !== window || !event.data || !event.data.type) {
    return;
  }
  
  const { data } = event;

  // Route message based on its type
  switch (data.type) {
    case 'VTF_REQUEST_WORKLET_URL':
      handleWorkletUrlRequest();
      break;
    case 'VTF_AUDIO_DATA':
      handleAudioData(data);
      break;
    // Add other message types here if needed in the future
  }
});

function handleWorkletUrlRequest() {
  try {
    const workletUrl = chrome.runtime.getURL('vtf-audio-processor.js');
    window.postMessage({ type: 'VTF_WORKLET_URL', url: workletUrl }, '*');
  } catch (error) {
    console.error('[Content] Error getting or sending worklet URL:', error);
    if (error.message.includes('Extension context invalidated')) {
      showRefreshNotification();
    }
  }
}

function handleAudioData(data) {
  try {
    if (!validateMessage(data, 'VTF_AUDIO_DATA')) {
      return; // Validation failed, don't proceed
    }

    // Send audio data to background script
    chrome.runtime.sendMessage({
      type: 'audioData',
      audioData: data.audioData,
      streamId: data.streamId,
      timestamp: data.timestamp
    }).catch(error => {
      console.error('[Content] Failed to send audio data to background:', error);
      if (error.message.includes('Extension context invalidated')) {
        showRefreshNotification();
      }
    });
  } catch (error) {
    console.error('[Content] Error handling audio data:', error);
    if (error.message.includes('Extension context invalidated')) {
      showRefreshNotification();
    }
  }
}
// --- END FIX ---

// Inject the main page-context script
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
script.onload = function() {
  console.log('VTF Audio Extension: Inject script loaded');
  this.remove();
};
(document.head || document.documentElement).appendChild(script);

// Keep track of audio chunks sent
let chunksSent = 0;
let processedSegments = []; // Store processed conversation segments

// Debug flag
const DEBUG_CAPTURE = false;

// Flag to stop traffic after extension reload is detected
let contextInvalidated = false;

// Message validation function
function validateMessage(data, expectedType) {
    if (!data || typeof data !== 'object') {
        console.warn('[Content] Invalid message: not an object', data);
        return false;
    }

    if (data.type !== expectedType) {
        console.warn(`[Content] Invalid message type: expected ${expectedType}, got ${data.type}`, data);
        return false;
    }

    // Suppress noisy validation logging
    // console.log('[Content-Debug] Validating VTF_AUDIO_DATA. Received data:', data);

    if (expectedType === 'VTF_AUDIO_DATA') {
        const isAudioArray = Array.isArray(data.audioData) && data.audioData.length > 0;
        const hasStreamId = typeof data.streamId === 'string' && data.streamId.length > 0;
        const hasTimestamp = typeof data.timestamp === 'number' && data.timestamp > 0;

        // Suppress noisy validation logging
        // console.log('[Content-Debug] Validation Checks: isAudioArray=' + isAudioArray + ', hasStreamId=' + hasStreamId + ', hasTimestamp=' + hasTimestamp);

        if (!isAudioArray) {
            console.warn('[Content] Invalid audio data: not an array or empty', data);
            return false;
        }

        if (!hasStreamId) {
            console.warn('[Content] Invalid audio data: missing or invalid streamId', data);
            return false;
        }

        if (!hasTimestamp) {
            console.warn('[Content] Invalid audio data: missing or invalid timestamp', data);
            return false;
        }
    }

    return true;
}

function disableCaptureDueToInvalidContext() {
  window.removeEventListener('message', handleAudioData);
  window.postMessage({ type: 'VTF_STOP_CAPTURE' }, '*');
}

// Show reload notification
function showReloadNotification() {
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
  if (!isExtensionValid()) {
    console.warn('[Content] Extension context invalid, ignoring message');
    return false;
  }
  
  try {
    if (request.action === 'startManualCapture' || request.type === 'start_capture') {
      console.log('[Content] Manual capture start requested');
      window.postMessage({ type: 'VTF_START_CAPTURE' }, '*');
      sendResponse({status: 'started', timestamp: Date.now()});
      return false;
    }
    
    if (request.action === 'stopManualCapture' || request.type === 'stop_capture') {
      console.log('[Content] Manual capture stop requested');
      window.postMessage({ type: 'VTF_STOP_CAPTURE' }, '*');
      sendResponse({status: 'stopped', timestamp: Date.now()});
      return false;
    }
    
    if (request.type === 'processedTranscription') {
      if (request.segment && request.segment.text) {
        console.log(`[Content] Processed segment received: "${request.segment.text.substring(0, 50)}..."`);
        processedSegments.push(request.segment);
        displayProcessedSegment(request.segment);
      } else {
        console.warn('[Content] Received processedTranscription message but segment or text is missing:', request);
      }
      sendResponse({received: true});
      return false;
    }
    
    if (request.type === 'newTranscription') {
      // Don't display raw transcriptions - wait for processed segments
      console.log('[Content] Raw transcription received - waiting for processed segment');
      sendResponse({received: true});
      return false;
    }
    
    if (request.type === 'buffer_status') {
      updateBufferStatus(request);
      sendResponse({received: true});
      return false;
    }
    
    sendResponse({received: true, handled: false});
    return false;
    
  } catch (error) {
    console.error('[Content] Error handling message:', error);
    if (error.message.includes('context invalidated')) {
      showReloadNotification();
    }
    return false;
  }
});

// Create floating transcription display with professional design
function createTranscriptionDisplay() {
  if (document.getElementById('vtf-transcription-display')) return;
  
  const display = document.createElement('div');
  display.id = 'vtf-transcription-display';
  display.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 500px;
    max-height: 400px;
    background: rgba(20, 20, 20, 0.95);
    color: white;
    padding: 0;
    border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    overflow: hidden;
    z-index: 10000;
    display: none;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(10px);
  `;
  
  // Make the display draggable
  makeDraggable(display);
  
  // Header with status indicators
  const header = document.createElement('div');
  header.className = 'vtf-header';
  header.style.cssText = `
    padding: 16px 20px;
    background: rgba(255, 255, 255, 0.05);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: move;
  `;
  
  header.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <span style="font-weight: 600; font-size: 16px;">VTF Trading Room</span>
      <div id="vtf-processing-indicator" style="
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #4CAF50;
        display: none;
        animation: pulse 1.5s infinite;
      "></div>
    </div>
    <div style="display: flex; gap: 12px; align-items: center;">
      <div style="font-size: 12px; color: #999;">
        <span id="vtf-segment-count">0</span> segments
      </div>
      <button id="vtf-clear-btn" style="
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #fff;
        padding: 4px 12px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
      ">Clear</button>
      <button id="vtf-export-btn" style="
        background: rgba(33, 150, 243, 0.2);
        border: 1px solid rgba(33, 150, 243, 0.4);
        color: #2196F3;
        padding: 4px 12px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
        font-weight: 500;
      ">Export</button>
    </div>
  `;
  
  display.appendChild(header);
  
  // Content area
  const contentWrapper = document.createElement('div');
  contentWrapper.style.cssText = `
    max-height: 320px;
    overflow-y: auto;
    padding: 12px;
  `;
  
  const content = document.createElement('div');
  content.id = 'vtf-transcription-content';
  contentWrapper.appendChild(content);
  display.appendChild(contentWrapper);
  
  // Add styles
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }
    
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateX(20px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
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
    
    .vtf-segment {
      margin-bottom: 16px;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 8px;
      border-left: 3px solid #4CAF50;
      animation: slideIn 0.3s ease-out;
      transition: all 0.2s ease;
    }
    
    .vtf-segment:hover {
      background: rgba(255, 255, 255, 0.05);
      transform: translateX(2px);
    }
    
    .vtf-segment-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    
    .vtf-speaker-info {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .vtf-speaker-name {
      font-weight: 600;
      color: #4CAF50;
      font-size: 14px;
    }
    
    .vtf-topic-badge {
      background: rgba(33, 150, 243, 0.2);
      color: #2196F3;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
    }
    
    .vtf-segment-meta {
      display: flex;
      gap: 12px;
      font-size: 11px;
      color: #666;
    }
    
    .vtf-segment-text {
      color: #fff;
      line-height: 1.6;
      font-size: 14px;
    }
    
    .vtf-confidence-high { color: #4CAF50; }
    .vtf-confidence-medium { color: #FF9800; }
    .vtf-confidence-low { color: #F44336; }
  `;
  document.head.appendChild(style);
  
  // Add to DOM
  document.body.appendChild(display);
  
  // Add button handlers
  const clearBtn = document.getElementById('vtf-clear-btn');
  if (clearBtn) {
    clearBtn.onclick = () => {
      // Clear all displayed segments
      const content = document.getElementById('vtf-transcription-content');
      if (content) {
        content.innerHTML = '';
        processedSegments = [];
        
        // Update count
        const countElement = document.getElementById('vtf-segment-count');
        if (countElement) {
          countElement.textContent = '0';
        }
        
        showNotification('Transcription display cleared', 'success');
      }
    };
  }
  
  const exportBtn = document.getElementById('vtf-export-btn');
  if (exportBtn) {
    exportBtn.onclick = () => {
      console.log('[Content] Export button clicked');
      exportProcessedSegments();
    };
  }
}

// Display processed conversation segment
function displayProcessedSegment(segment) {
  const display = document.getElementById('vtf-transcription-display');
  if (!display) {
    createTranscriptionDisplay();
    return displayProcessedSegment(segment);
  }
  
  display.style.display = 'block';
  const content = document.getElementById('vtf-transcription-content');
  
  const segmentElement = document.createElement('div');
  segmentElement.className = 'vtf-segment';
  
  // Fix: Use timestamp instead of startTime, and handle Invalid Date
  const timestamp = segment.timestamp || segment.startTime || Date.now();
  const startTime = new Date(timestamp);
  const duration = segment.duration ? `${segment.duration.toFixed(1)}s` : '';
  
  // Confidence styling
  let confidenceClass = 'vtf-confidence-low';
  let confidenceText = 'Low';
  if (segment.confidence > 0.8) {
    confidenceClass = 'vtf-confidence-high';
    confidenceText = 'High';
  } else if (segment.confidence > 0.6) {
    confidenceClass = 'vtf-confidence-medium';
    confidenceText = 'Medium';
  }
  
  // Format time safely
  const timeString = isNaN(startTime.getTime()) ? 'Unknown Time' : startTime.toLocaleTimeString();
  
  segmentElement.innerHTML = `
    <div class="vtf-segment-header">
      <div class="vtf-speaker-info">
        <span class="vtf-speaker-name">${segment.speaker || 'Unknown Speaker'}</span>
        <span class="vtf-topic-badge">Trading</span>
      </div>
      <div class="vtf-segment-meta">
        <span>${timeString}</span>
        ${duration ? `<span>${duration}</span>` : ''}
        <span class="${confidenceClass}">${confidenceText}</span>
      </div>
    </div>
    <div class="vtf-segment-text">${segment.text}</div>
  `;
  
  content.insertBefore(segmentElement, content.firstChild);
  
  // Update count
  const countElement = document.getElementById('vtf-segment-count');
  if (countElement) {
    countElement.textContent = content.children.length;
  }
  
  // Scroll to top
  const contentWrapper = content.parentElement;
  contentWrapper.scrollTop = 0;
  
  // Keep only last 50 segments
  while (content.children.length > 50) {
    content.removeChild(content.lastChild);
  }
}

// Update buffer status visualization
function updateBufferStatus(status) {
  if (!document.getElementById('vtf-transcription-display')) {
    createTranscriptionDisplay();
  }
  
  const processingIndicator = document.getElementById('vtf-processing-indicator');
  if (processingIndicator) {
    processingIndicator.style.display = status.isProcessing ? 'block' : 'none';
  }
}

// Make element draggable
function makeDraggable(element) {
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };
  
  const header = element.querySelector('.vtf-header');
  if (!header) return;
  
  header.addEventListener('mousedown', (e) => {
    isDragging = true;
    const rect = element.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    e.preventDefault();
    document.body.style.userSelect = 'none';
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const x = e.clientX - dragOffset.x;
    const y = e.clientY - dragOffset.y;
    
    const maxX = window.innerWidth - element.offsetWidth;
    const maxY = window.innerHeight - element.offsetHeight;
    
    const boundedX = Math.max(0, Math.min(x, maxX));
    const boundedY = Math.max(0, Math.min(y, maxY));
    
    element.style.left = boundedX + 'px';
    element.style.top = boundedY + 'px';
    element.style.bottom = 'auto';
    element.style.right = 'auto';
  });
  
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.userSelect = '';
      
      // Save position
      const rect = element.getBoundingClientRect();
      localStorage.setItem('vtf-display-position', JSON.stringify({
        x: rect.left,
        y: rect.top
      }));
    }
  });
  
  // Restore saved position
  try {
    const saved = localStorage.getItem('vtf-display-position');
    if (saved) {
      const position = JSON.parse(saved);
      element.style.left = position.x + 'px';
      element.style.top = position.y + 'px';
      element.style.bottom = 'auto';
      element.style.right = 'auto';
    }
  } catch (e) {
    // Ignore errors
  }
}

// Export processed segments
function exportProcessedSegments() {
  console.log('[Content] Exporting processed segments');
  
  if (processedSegments.length === 0) {
    alert('No segments to export');
    return;
  }
  
  // Create markdown content
  const now = new Date();
  const dateStr = now.toLocaleDateString();
  const timeStr = now.toLocaleTimeString();
  
  let markdown = `# VTF Trading Room Transcript\n\n`;
  markdown += `**Date:** ${dateStr}\n`;
  markdown += `**Time:** ${timeStr}\n`;
  markdown += `**Total Segments:** ${processedSegments.length}\n\n`;
  markdown += `---\n\n`;
  
  // Group segments by conversation
  let currentConversation = [];
  let conversations = [];
  
  processedSegments.forEach((segment, index) => {
    if (index === 0) {
      currentConversation.push(segment);
    } else {
      const prevSegment = processedSegments[index - 1];
      const timeDiff = segment.startTime - prevSegment.endTime;
      
      // New conversation if gap > 10 seconds
      if (timeDiff > 10000) {
        conversations.push(currentConversation);
        currentConversation = [segment];
      } else {
        currentConversation.push(segment);
      }
    }
  });
  
  if (currentConversation.length > 0) {
    conversations.push(currentConversation);
  }
  
  // Format conversations
  conversations.forEach((conversation, convIndex) => {
    const startTime = new Date(conversation[0].startTime);
    const speakers = [...new Set(conversation.map(s => s.speaker))].join(', ');
    const topics = [...new Set(conversation.map(s => s.topic))].join(', ');
    
    markdown += `## Conversation ${convIndex + 1} (${startTime.toLocaleTimeString()})\n\n`;
    markdown += `**Speakers:** ${speakers}\n`;
    markdown += `**Topics:** ${topics}\n\n`;
    
    conversation.forEach(segment => {
      const time = new Date(segment.startTime).toLocaleTimeString();
      markdown += `**${segment.speaker}** *(${time})*: ${segment.text}\n\n`;
    });
    
    markdown += `---\n\n`;
  });
  
  // Create and download file
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vtf-trading-room-${dateStr.replace(/\//g, '-')}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  console.log(`[Content] Exported ${processedSegments.length} segments in ${conversations.length} conversations`);
  
  // Show success notification
  showNotification(`Exported ${processedSegments.length} segments`, 'success');
}

// Show notification
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'success' ? 'rgba(76, 175, 80, 0.9)' : 'rgba(33, 150, 243, 0.9)'};
    color: white;
    padding: 12px 20px;
    border-radius: 6px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 14px;
    z-index: 10001;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.3s ease;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 3000);
}

// Auto-start capture when page loads
window.addEventListener('load', () => {
  console.log('VTF Audio Extension: Page loaded, checking if should auto-start...');
  
  if (!isExtensionValid()) {
    console.warn('[Content] Extension context invalid on load');
    return;
  }
  
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
              console.log('[Content] Extension recently reloaded, skipping auto-start');
            }
          } else {
            console.log('[Content] Auto-start successful');
            showNotification('VTF Audio Transcription Started', 'success');
          }
        });
      }
    });
  } catch (error) {
    console.error('[Content] Error in auto-start:', error);
  }
});

console.log('VTF Audio Extension: Ready for transcription display');

function showRefreshNotification() {
  // Only show once
  if (window.vtfRefreshNotificationShown) return;
  window.vtfRefreshNotificationShown = true;
  
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #ef4444;
    color: white;
    padding: 16px 20px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    z-index: 10001;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    max-width: 300px;
  `;
  
  notification.innerHTML = `
    <div style="font-weight: 600; margin-bottom: 8px;">VTF Transcriber Extension</div>
    <div style="margin-bottom: 12px;">Extension was reloaded. Please refresh this page to resume transcription.</div>
    <button onclick="window.location.reload()" style="
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      color: white;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    ">Refresh Page</button>
  `;
  
  document.body.appendChild(notification);
  
  // Auto-remove after 10 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 10000);
}