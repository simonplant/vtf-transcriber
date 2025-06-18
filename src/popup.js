// popup.js - VTF Capture Dashboard

// DOM elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const copyBtn = document.getElementById('copyBtn');
const exportBtn = document.getElementById('exportBtn');
const dailyExportBtn = document.getElementById('dailyExportBtn');
const statusIndicator = document.getElementById('statusIndicator');
const captureStatus = document.getElementById('captureStatus');
const chunksCount = document.getElementById('chunksCount');
const transcriptionCount = document.getElementById('transcriptionCount');
const activeSpeakers = document.getElementById('activeSpeakers');
const sessionCost = document.getElementById('sessionCost');
const performanceMetrics = document.getElementById('performanceMetrics');
const speechActivity = document.getElementById('speechActivity');
const processingStatus = document.getElementById('processingStatus');
const lastTranscription = document.getElementById('lastTranscription');
const audioQuality = document.getElementById('audioQuality');
const currentTranscript = document.getElementById('currentTranscript');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');
// VAD elements
const voiceActivity = document.getElementById('voiceActivity');
const vadProbability = document.getElementById('vadProbability');
const signalNoise = document.getElementById('signalNoise');
const spectralCentroid = document.getElementById('spectralCentroid');

// Channel elements
const activeChannels = document.getElementById('activeChannels');
const totalTracks = document.getElementById('totalTracks');
const channelList = document.getElementById('channelList');

// Audio level visualization elements
let audioLevelCanvas = null;
let audioLevelCtx = null;
let audioLevelHistory = [];

// State
let isTranscribing = false;
let sessionStartTime = null;
let totalAudioMinutes = 0;
let lastTranscriptTime = null;
let currentTranscriptPreview = '';

// Whisper API pricing (as of 2024)
const WHISPER_COST_PER_MINUTE = 0.006; // $0.006 per minute

// Fallback clipboard function for older browsers or when clipboard API fails
function fallbackCopyToClipboard(text, count) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    const successful = document.execCommand('copy');
    if (successful) {
      console.log('[Popup] Fallback copy successful');
      showSuccess(`Copied ${count} transcriptions to clipboard`);
    } else {
      console.error('[Popup] Fallback copy failed');
      showError('Failed to copy to clipboard');
    }
  } catch (err) {
    console.error('[Popup] Fallback copy error:', err);
    showError('Failed to copy to clipboard');
  } finally {
    document.body.removeChild(textArea);
  }
}

// Start capture
if (startBtn) {
  startBtn.onclick = async () => {
    console.log('[Popup] Start button clicked');
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    
    if (!tab.url || !tab.url.includes('vtf.t3live.com')) {
      showError('Please navigate to VTF first');
      return;
    }
    
    // Track session start
    sessionStartTime = Date.now();
    totalAudioMinutes = 0;
    
    // Send to content script
    chrome.tabs.sendMessage(tab.id, {type: 'start_capture'}, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending to content script:', chrome.runtime.lastError);
        showError('Failed to start capture on page');
      } else {
        console.log('Content script response:', response);
      }
    });
    
    // Also notify background script
    chrome.runtime.sendMessage({type: 'startCapture'}, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending to background:', chrome.runtime.lastError);
      } else {
        console.log('Background response:', response);
        updateStatus(true);
      }
    });
  };
}

// Stop capture
if (stopBtn) {
  stopBtn.onclick = async () => {
    console.log('[Popup] Stop button clicked');
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    
    // Send to content script
    chrome.tabs.sendMessage(tab.id, {type: 'stop_capture'}, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending to content script:', chrome.runtime.lastError);
      } else {
        console.log('Content script response:', response);
      }
    });
    
    // Also notify background script
    chrome.runtime.sendMessage({type: 'stopCapture'}, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending to background:', chrome.runtime.lastError);
      } else {
        console.log('Background response:', response);
        updateStatus(false);
      }
    });
  };
}

// Copy all transcriptions
if (copyBtn) {
  copyBtn.onclick = async () => {
    console.log('[Popup] Copy all button clicked');
    
    // Disable button during operation
    copyBtn.disabled = true;
    copyBtn.textContent = 'Copying...';
    
    chrome.runtime.sendMessage({type: 'getTranscriptions'}, (response) => {
      console.log('[Popup] getTranscriptions response:', response);
      
      if (chrome.runtime.lastError || !response || !response.transcriptions) {
        console.error('[Popup] Error getting transcriptions:', chrome.runtime.lastError);
        showError('No transcriptions available to copy');
        copyBtn.disabled = false;
        copyBtn.textContent = 'Copy All';
        return;
      }
      
      const transcriptions = response.transcriptions;
      console.log('[Popup] Found transcriptions:', transcriptions.length);
      
      if (transcriptions.length === 0) {
        showError('No transcriptions available to copy');
        copyBtn.disabled = false;
        copyBtn.textContent = 'Copy All';
        return;
      }
      
      // Format transcriptions as plain text
      const textContent = transcriptions.map(t => {
        const timestamp = new Date(t.timestamp).toLocaleTimeString();
        const speaker = t.speaker || 'Unknown';
        return `[${timestamp}] ${speaker}: ${t.text}`;
      }).join('\n');
      
      console.log('[Popup] Formatted text content:', textContent.substring(0, 100) + '...');
      
      // Copy to clipboard using async function
      (async () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          try {
            await navigator.clipboard.writeText(textContent);
            console.log('[Popup] Successfully copied to clipboard');
            showSuccess(`Copied ${transcriptions.length} transcriptions to clipboard`);
          } catch (err) {
            console.error('[Popup] Clipboard API failed:', err);
            // Fallback to legacy method
            fallbackCopyToClipboard(textContent, transcriptions.length);
          }
        } else {
          console.log('[Popup] Using fallback copy method');
          fallbackCopyToClipboard(textContent, transcriptions.length);
        }
        
        // Re-enable button
        copyBtn.disabled = false;
        copyBtn.textContent = 'Copy All';
      })();
    });
  };
}

// Export all transcriptions
if (exportBtn) {
  exportBtn.onclick = async () => {
    console.log('[Popup] Export all button clicked');
    
    // Disable button during operation
    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting...';
    
    chrome.runtime.sendMessage({type: 'getTranscriptions'}, (response) => {
      console.log('[Popup] getTranscriptions response for export:', response);
      
      if (chrome.runtime.lastError || !response || !response.transcriptions) {
        console.error('[Popup] Error getting transcriptions for export:', chrome.runtime.lastError);
        showError('No transcriptions available to export');
        exportBtn.disabled = false;
        exportBtn.textContent = 'Export All';
        return;
      }
      
      const transcriptions = response.transcriptions;
      console.log('[Popup] Found transcriptions for export:', transcriptions.length);
      
      if (transcriptions.length === 0) {
        showError('No transcriptions available to export');
        exportBtn.disabled = false;
        exportBtn.textContent = 'Export All';
        return;
      }
      
      // Create markdown content
      const now = new Date();
      const dateStr = now.toLocaleDateString();
      const timeStr = now.toLocaleTimeString();
      
      let markdown = `# VTF Transcription Export\n\n`;
      markdown += `**Date:** ${dateStr}\n`;
      markdown += `**Time:** ${timeStr}\n`;
      markdown += `**Total Transcriptions:** ${transcriptions.length}\n\n`;
      markdown += `---\n\n`;
      
      transcriptions.forEach((t, index) => {
        const timestamp = new Date(t.timestamp).toLocaleTimeString();
        const speaker = t.speaker || 'Unknown';
        markdown += `## ${index + 1}. ${speaker} (${timestamp})\n\n`;
        markdown += `${t.text}\n\n`;
      });
      
      console.log('[Popup] Generated markdown length:', markdown.length);
      
      // Create and download file
      try {
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vtf-transcriptions-${dateStr.replace(/\//g, '-')}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('[Popup] Export download triggered successfully');
        showSuccess(`Exported ${transcriptions.length} transcriptions as markdown`);
        exportBtn.disabled = false;
        exportBtn.textContent = 'Export All';
      } catch (err) {
        console.error('[Popup] Export failed:', err);
        showError('Failed to export transcriptions');
        exportBtn.disabled = false;
        exportBtn.textContent = 'Export All';
      }
    });
  };
}

// Daily export - comprehensive markdown for the entire day
if (dailyExportBtn) {
  dailyExportBtn.onclick = async () => {
    console.log('[Popup] Daily export button clicked');
    
    // Disable button during operation
    dailyExportBtn.disabled = true;
    dailyExportBtn.textContent = 'Generating...';
    
    chrome.runtime.sendMessage({type: 'getDailyMarkdown'}, (response) => {
      console.log('[Popup] getDailyMarkdown response:', response);
      
      if (chrome.runtime.lastError || !response || !response.markdown) {
        console.error('[Popup] Error getting daily markdown:', chrome.runtime.lastError);
        showError('Failed to generate daily export');
        dailyExportBtn.disabled = false;
        dailyExportBtn.textContent = 'Daily Export';
        return;
      }
      
      const markdown = response.markdown;
      const date = response.date;
      
      console.log('[Popup] Generated daily markdown length:', markdown.length);
      
      // Create and download file
      try {
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vtf-trading-room-${date}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('[Popup] Daily export download triggered successfully');
        showSuccess(`Daily trading room export saved for ${date}`);
        dailyExportBtn.disabled = false;
        dailyExportBtn.textContent = 'Daily Export';
      } catch (err) {
        console.error('[Popup] Daily export failed:', err);
        showError('Failed to export daily markdown');
        dailyExportBtn.disabled = false;
        dailyExportBtn.textContent = 'Daily Export';
      }
    });
  };
}

// Update UI status
function updateStatus(isCapturing) {
  isTranscribing = isCapturing;
  
  if (isCapturing) {
    statusIndicator.classList.add('active');
    captureStatus.querySelector('span').textContent = 'Capturing';
    captureStatus.classList.add('active');
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else {
    statusIndicator.classList.remove('active');
    captureStatus.querySelector('span').textContent = 'Not Capturing';
    captureStatus.classList.remove('active');
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

// Calculate session cost
function calculateSessionCost(chunks, transcriptions) {
  // Estimate audio minutes from chunks (assuming 1-second chunks on average)
  totalAudioMinutes = chunks / 60;
  const cost = totalAudioMinutes * WHISPER_COST_PER_MINUTE;
  return cost;
}

// Update activity display
function updateActivityDisplay(response) {
  // Update speech activity
  const activity = response.speechActivity || 'none';
  speechActivity.className = `vtf-metric-value ${activity}`;
  speechActivity.textContent = activity.charAt(0).toUpperCase() + activity.slice(1);
  
  // Update processing status
  const isProcessing = response.isProcessing || false;
  processingStatus.className = isProcessing ? 'vtf-metric-value processing' : 'vtf-metric-value none';
  processingStatus.textContent = isProcessing ? 'Active' : 'Idle';
  
  // Update audio quality using new function
  if (response.audioQualityStats) {
    updateAudioQualityDisplay(response.audioQualityStats);
  } else if (response.audioQuality) {
    // Fallback for older format
    const quality = response.audioQuality.toLowerCase();
    audioQuality.className = `vtf-metric-value ${quality}`;
    audioQuality.textContent = quality.charAt(0).toUpperCase() + quality.slice(1);
  } else {
    audioQuality.className = 'vtf-metric-value none';
    audioQuality.textContent = 'Unknown';
  }
  
  // Update last transcription time
  if (response.transcriptionCount > 0) {
    const now = Date.now();
    if (!lastTranscriptTime || response.transcriptionCount !== lastTranscriptTime.count) {
      lastTranscriptTime = { time: now, count: response.transcriptionCount };
    }
    
    const timeSinceLastTranscript = now - lastTranscriptTime.time;
    const timeText = formatTimeSince(timeSinceLastTranscript);
    lastTranscription.textContent = timeText;
    lastTranscription.className = timeSinceLastTranscript < 30000 ? 'vtf-metric-value recent' : 'vtf-metric-value old';
  } else {
    lastTranscription.textContent = 'Never';
    lastTranscription.className = 'vtf-metric-value old';
  }
}

// Format time since last event
function formatTimeSince(ms) {
  if (ms < 1000) return 'Just now';
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  return `${Math.floor(ms / 3600000)}h ago`;
}

// Update channel display
function updateChannelDisplay(channelStats) {
  if (activeChannels) {
    activeChannels.textContent = channelStats.activeChannels || 0;
    activeChannels.className = channelStats.activeChannels > 0 ? 'vtf-metric-value high' : 'vtf-metric-value';
  }
  
  if (totalTracks) {
    totalTracks.textContent = channelStats.channels ? channelStats.channels.length : 0;
  }
  
  if (channelList) {
    const channels = channelStats.channels || [];
    
    if (channels.length === 0) {
      channelList.innerHTML = '<div class="vtf-channel-empty">No active channels</div>';
    } else {
      channelList.innerHTML = channels.map(channel => {
        const timeAgo = formatTimeSince(channel.timeSinceActivity);
        const voicePercent = parseFloat(channel.voiceActivity);
        const voiceClass = voicePercent > 50 ? 'vtf-channel-voice-activity' : '';
        
        return `
          <div class="vtf-channel-item" title="Stream: ${channel.streamId || 'N/A'}">
            <div class="vtf-channel-info">
              <div class="vtf-channel-id">${channel.trackId.substring(0, 12)}...</div>
              <div class="vtf-channel-label">${channel.trackLabel || 'Unknown Track'}</div>
            </div>
            <div class="vtf-channel-stats">
              <div class="${voiceClass}">${channel.voiceActivity}% voice</div>
              <div class="vtf-channel-time">${timeAgo}</div>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

// Update current transcript preview
function updateTranscriptPreview() {
  chrome.runtime.sendMessage({type: 'getTranscriptions'}, (response) => {
    if (chrome.runtime.lastError || !response || !response.transcriptions) {
      return;
    }
    
    const transcriptions = response.transcriptions;
    if (transcriptions.length > 0) {
      const latest = transcriptions[transcriptions.length - 1];
      const preview = latest.text.length > 60 ? latest.text.substring(0, 60) + '...' : latest.text;
      const speaker = latest.speaker || 'Unknown';
      
      currentTranscript.innerHTML = `
        <div class="vtf-transcript-preview active">
          <strong>${speaker}:</strong> ${preview}
        </div>
      `;
    } else {
      currentTranscript.innerHTML = `
        <div class="vtf-transcript-preview empty">
          Waiting for audio...
        </div>
      `;
    }
  });
}

// Check status
function checkStatus() {
  chrome.runtime.sendMessage({type: 'getStatus'}, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[Popup] Error getting status:', chrome.runtime.lastError);
      return;
    }
    
    console.log('[Popup] Status:', response);
    if (response) {
      updateStatus(response.isCapturing);
      
      // Update metrics
      chunksCount.textContent = response.chunksReceived || 0;
      transcriptionCount.textContent = response.transcriptionCount || 0;
      activeSpeakers.textContent = response.activeSpeakers || 0;
      
      // Calculate and display session cost
      const cost = calculateSessionCost(response.chunksReceived || 0, response.transcriptionCount || 0);
      sessionCost.textContent = `$${cost.toFixed(3)}`;
      
      // Color code the cost
      if (cost > 1.0) {
        sessionCost.className = 'vtf-metric-value danger';
      } else if (cost > 0.5) {
        sessionCost.className = 'vtf-metric-value warning';
      } else {
        sessionCost.className = 'vtf-metric-value';
      }
      
      // Update activity display
      updateActivityDisplay(response);
      
      // Update VAD statistics if available
      if (response.vadStats) {
        const vad = response.vadStats;
        voiceActivity.textContent = `${vad.voiceActivity}%`;
        vadProbability.textContent = vad.avgProbability;
        signalNoise.textContent = vad.avgSNR;
        spectralCentroid.textContent = vad.avgSpectralCentroid;
        
        // Color code voice activity
        const voicePercent = parseFloat(vad.voiceActivity);
        if (voicePercent > 70) {
          voiceActivity.className = 'vtf-metric-value high';
        } else if (voicePercent > 30) {
          voiceActivity.className = 'vtf-metric-value medium';
        } else {
          voiceActivity.className = 'vtf-metric-value low';
        }
        
        // Color code SNR
        const snrValue = parseFloat(vad.avgSNR);
        if (snrValue > 10) {
          signalNoise.className = 'vtf-metric-value high';
        } else if (snrValue > 5) {
          signalNoise.className = 'vtf-metric-value medium';
        } else {
          signalNoise.className = 'vtf-metric-value low';
        }
        
        // Update audio level visualization based on voice activity and probability
        const audioLevel = Math.max(
          parseFloat(vad.avgProbability || 0), 
          parseFloat(vad.voiceActivity || 0) / 100
        );
        updateAudioLevel(audioLevel);
      }
      
      // Update performance metrics if available
      if (response.performance) {
        performanceMetrics.innerHTML = `
          <span>API Calls: ${response.performance.apiCalls}</span>
          <span>Avg: ${response.performance.avgResponseTime}ms</span>
          <span>Errors: ${response.performance.errorRate}%</span>
        `;
      }
      
      // Update channel information if available
      if (response.channelStats) {
        updateChannelDisplay(response.channelStats);
      }
    }
  });
  
  // Update transcript preview
  updateTranscriptPreview();
}

// Show error message
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.remove('vtf-hidden');
  successMessage.classList.add('vtf-hidden');
  setTimeout(() => {
    errorMessage.classList.add('vtf-hidden');
  }, 5000);
}

// Show success message
function showSuccess(message) {
  successMessage.textContent = message;
  successMessage.classList.remove('vtf-hidden');
  errorMessage.classList.add('vtf-hidden');
  setTimeout(() => {
    successMessage.classList.add('vtf-hidden');
  }, 3000);
}

// Initial status check
checkStatus();

// Update periodically
setInterval(() => {
  checkStatus();
}, 3000);

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Popup] DOM loaded, checking tab...');
  
  // Initialize audio level visualization
  initAudioLevelVisualization();
  
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    const tab = tabs[0];
    if (!tab.url || !tab.url.includes('vtf.t3live.com')) {
      showError('Please navigate to VTF (vtf.t3live.com)');
      startBtn.disabled = true;
      stopBtn.disabled = true;
    }
  });
});

// Update audio quality display
function updateAudioQualityDisplay(qualityStats) {
  if (!qualityStats) return;
  
  const quality = qualityStats.overall || 'unknown';
  audioQuality.textContent = quality.charAt(0).toUpperCase() + quality.slice(1);
  
  // Color coding
  switch (quality) {
    case 'excellent':
      audioQuality.className = 'vtf-metric-value high';
      break;
    case 'good':
      audioQuality.className = 'vtf-metric-value good';
      break;
    case 'fair':
      audioQuality.className = 'vtf-metric-value fair';
      break;
    case 'poor':
      audioQuality.className = 'vtf-metric-value poor';
      break;
    default:
      audioQuality.className = 'vtf-metric-value none';
  }
  
  // Update detailed quality metrics if available
  if (qualityStats.metrics) {
    const m = qualityStats.metrics;
    audioQuality.title = `Clarity: ${m.clarity || 'N/A'}\nNoise: ${m.noise || 'N/A'}\nClipping: ${m.clipping || 'None'}`;
  }
}

// Initialize audio level visualization
function initAudioLevelVisualization() {
  audioLevelCanvas = document.getElementById('audioLevelCanvas');
  if (audioLevelCanvas) {
    audioLevelCtx = audioLevelCanvas.getContext('2d');
    audioLevelCanvas.width = 280;
    audioLevelCanvas.height = 60;
    
    // Initialize history array
    audioLevelHistory = new Array(140).fill(0);
    
    // Start animation
    drawAudioLevels();
  }
}

// Draw audio level visualization
function drawAudioLevels() {
  if (!audioLevelCtx) return;
  
  const width = audioLevelCanvas.width;
  const height = audioLevelCanvas.height;
  
  // Clear canvas
  audioLevelCtx.fillStyle = 'rgba(0, 0, 0, 0.1)';
  audioLevelCtx.fillRect(0, 0, width, height);
  
  // Draw grid lines
  audioLevelCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  audioLevelCtx.lineWidth = 1;
  
  // Horizontal lines at -20dB, -10dB, 0dB
  const levels = [0.1, 0.3, 1.0];
  levels.forEach(level => {
    const y = height - (level * height);
    audioLevelCtx.beginPath();
    audioLevelCtx.moveTo(0, y);
    audioLevelCtx.lineTo(width, y);
    audioLevelCtx.stroke();
  });
  
  // Draw audio level history
  audioLevelCtx.strokeStyle = '#4CAF50';
  audioLevelCtx.lineWidth = 2;
  audioLevelCtx.beginPath();
  
  for (let i = 0; i < audioLevelHistory.length; i++) {
    const x = (i / audioLevelHistory.length) * width;
    const level = audioLevelHistory[i];
    const y = height - (level * height * 0.8) - 5;
    
    if (i === 0) {
      audioLevelCtx.moveTo(x, y);
    } else {
      audioLevelCtx.lineTo(x, y);
    }
  }
  
  audioLevelCtx.stroke();
  
  // Draw peak indicator
  const currentLevel = audioLevelHistory[audioLevelHistory.length - 1];
  if (currentLevel > 0.7) {
    audioLevelCtx.fillStyle = '#FF5252';
  } else if (currentLevel > 0.3) {
    audioLevelCtx.fillStyle = '#4CAF50';
  } else {
    audioLevelCtx.fillStyle = '#666';
  }
  
  const peakX = width - 10;
  const peakY = height - (currentLevel * height * 0.8) - 5;
  audioLevelCtx.beginPath();
  audioLevelCtx.arc(peakX, peakY, 3, 0, Math.PI * 2);
  audioLevelCtx.fill();
  
  requestAnimationFrame(drawAudioLevels);
}

// Update audio level history
function updateAudioLevel(level) {
  audioLevelHistory.shift();
  audioLevelHistory.push(Math.min(1, Math.max(0, level)));
}