/**
 * @file popup.js
 * @path src/popup.js
 * @description Handles the logic for the extension's popup UI, including button clicks, status updates, and communication with the background script.
 * @modified 2025-06-20
 */

document.addEventListener('DOMContentLoaded', () => {
    // State management
    let isCapturing = false;
    let transcriptions = [];
    let metrics = {
        speakers: 0,
        transcriptionCount: 0,
        sessionCost: 0,
        lastActivity: null
    };

    // DOM elements - updated for new design
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const statusBadge = document.querySelector('.status-badge');
    const statusText = statusBadge.querySelector('span');
    const pulseDot = document.querySelector('.pulse-dot');
    
    // Metric elements
    const speakersEl = document.querySelector('.metric-item:nth-child(1) .metric-value');
    const transcriptionCountEl = document.querySelector('.metric-item:nth-child(2) .metric-value');
    const sessionCostEl = document.querySelector('.metric-item:nth-child(3) .metric-value');
    
    // Visualizer elements
    const visualizerStatus = document.querySelector('.visualizer-status');
    const waveformBars = document.querySelectorAll('.waveform-bar');
    
    // Transcript elements
    const transcriptContent = document.querySelector('.transcript-content');
    const transcriptMeta = document.querySelector('.transcript-meta');
    const liveBadge = document.querySelector('.badge');
    
    // Quick action buttons - fix selectors to match actual HTML structure
    const actionButtons = document.querySelectorAll('.action-btn');
    const copyBtn = actionButtons[0]; // "📋 Copy All"
    const exportBtn = actionButtons[1]; // "💾 Export Session"  
    const analyticsBtn = actionButtons[2]; // "📊 View Analytics"
    const settingsBtn = actionButtons[3]; // "⚙️ Settings"
    const optionsLink = document.getElementById('optionsLink');
    const versionInfo = document.getElementById('versionInfo');

    // Animation intervals
    let waveformInterval = null;
    let activityTimeout = null;

    // --- Initial UI Reset ---
    function resetMetrics() {
      speakersEl.textContent = '0';
      transcriptionCountEl.textContent = '0';
      sessionCostEl.textContent = '$0.00';
      transcriptContent.textContent = 'No transcriptions yet. Start a recording to begin.';
      transcriptMeta.innerHTML = '';
      visualizerStatus.textContent = 'Inactive';
    }

    // --- Initialize popup ---
    function initializePopup() {
        resetMetrics();
        
        // Check if background script is ready and get current status
        chrome.runtime.sendMessage({ type: 'getStatus' }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn('[Popup] Background script not ready:', chrome.runtime.lastError);
                // Background script might not be ready yet, that's okay
            } else if (response && response.status === 'ok') {
                console.log('[Popup] Background script ready');
            }
        });
    }

    // Initialize the popup
    initializePopup();

    // --- Message Handlers ---
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.type) {
            case 'statusUpdate':
                if (message.status) updateUI(message.status);
                break;
            case 'transcriptionsUpdate':
                if (message.transcriptions) updateTranscriptionDisplay(message.transcriptions);
                break;
            case 'audioActivity':
                if (message.activity) updateAudioVisualizer(message.activity);
                break;
            case 'error':
                showNotification(message.message, 'error');
                break;
            case 'success':
                showNotification(message.message, 'success');
                break;
        }
    });

    // --- Event Handlers ---
    startBtn?.addEventListener('click', () => {
        chrome.storage.local.get(['openaiApiKey'], (result) => {
            if (!result.openaiApiKey) {
                showNotification('API Key not set. Please configure in settings.', 'error');
                return;
            }
            chrome.runtime.sendMessage({ type: 'startCapture', apiKey: result.openaiApiKey }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn('[Popup] Background script communication error:', chrome.runtime.lastError);
                    // Still show as started since the API key is valid
                    startCapturing();
                } else if (response && response.status === 'capturing') {
                    startCapturing();
                }
            });
        });
    });

    stopBtn?.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'stopCapture' }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn('[Popup] Background script communication error:', chrome.runtime.lastError);
                // Still stop the UI
                stopCapturing();
            } else if (response && response.status === 'stopped') {
                stopCapturing();
            }
        });
    });

    copyBtn?.addEventListener('click', () => {
        handleCopyTranscripts();
    });

    exportBtn?.addEventListener('click', () => {
        handleExport('session');
    });

    analyticsBtn?.addEventListener('click', () => {
        // Show analytics info since analytics.html doesn't exist
        showNotification('Analytics feature coming soon!', 'info');
    });

    settingsBtn?.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    optionsLink?.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });

    // --- UI Update Functions ---
    function startCapturing() {
        isCapturing = true;
        statusBadge.classList.remove('inactive');
        statusBadge.classList.add('active');
        statusText.textContent = 'Recording Live';
        pulseDot.classList.add('active');
        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        
        // Start waveform animation
        startWaveformAnimation();
        
        // Update live badge
        liveBadge.textContent = 'Live';
        liveBadge.style.background = 'rgba(239, 68, 68, 0.2)';
        liveBadge.style.color = '#ef4444';
    }

    function stopCapturing() {
        isCapturing = false;
        statusBadge.classList.remove('active', 'processing');
        statusBadge.classList.add('inactive');
        statusText.textContent = 'Recording Stopped';
        pulseDot.classList.remove('active');
        stopBtn.style.display = 'none';
        startBtn.style.display = 'block';
        
        // Stop waveform animation
        stopWaveformAnimation();
        
        // Update visualizer status
        visualizerStatus.textContent = 'Inactive';
        
        // Update live badge
        liveBadge.textContent = 'Paused';
        liveBadge.style.background = 'rgba(148, 163, 184, 0.2)';
        liveBadge.style.color = '#94a3b8';
    }

    function updateUI(status) {
        isCapturing = status.isCapturing;
        
        if (status.isCapturing) {
            startCapturing();
        } else {
            stopCapturing();
        }

        // Update metrics
        if (status.activeSpeakers !== undefined) {
            speakersEl.textContent = status.activeSpeakers;
            metrics.speakers = status.activeSpeakers;
        }
        
        if (status.transcriptionCount !== undefined) {
            transcriptionCountEl.textContent = status.transcriptionCount;
            metrics.transcriptionCount = status.transcriptionCount;
        }
        
        if (status.sessionCost !== undefined) {
            sessionCostEl.textContent = `$${status.sessionCost.toFixed(2)}`;
            metrics.sessionCost = status.sessionCost;
        }

        // Update processing status
        if (status.isProcessing) {
            statusBadge.classList.add('processing');
            statusText.textContent = 'Processing Audio...';
            visualizerStatus.textContent = 'Processing';
        }
    }

    function updateTranscriptionDisplay(transcriptions) {
        this.transcriptions = transcriptions;
        
        if (transcriptions.length > 0) {
            const latest = transcriptions[transcriptions.length - 1];
            
            // Update transcript content
            transcriptContent.textContent = `"${latest.text}"`;
            
            // Update metadata
            const time = new Date(latest.timestamp).toLocaleTimeString();
            const confidence = latest.confidence ? 
                (latest.confidence > 0.8 ? 'High' : 'Medium') + ' confidence' : '';
            
            transcriptMeta.innerHTML = `
                <span class="speaker-tag">${latest.speaker || 'Speaker 1'}</span>
                <span>${time}</span>
                ${confidence ? `<span>${confidence}</span>` : ''}
            `;
            
            // Flash the transcript section
            flashElement(transcriptContent.parentElement);
        }
        
        // Update count
        transcriptionCountEl.textContent = transcriptions.length;
    }

    function updateAudioVisualizer(activity) {
        // Update visualizer status based on activity
        if (activity.isSpeaking) {
            visualizerStatus.textContent = 'Voice Detected';
            visualizerStatus.style.color = '#22c55e';
        } else {
            visualizerStatus.textContent = 'Listening...';
            visualizerStatus.style.color = '#71717a';
        }
        
        // Update waveform intensity based on audio level
        if (activity.audioLevel && waveformBars.length > 0) {
            const intensity = Math.min(activity.audioLevel / 100, 1);
            waveformBars.forEach(bar => {
                const baseHeight = parseFloat(bar.style.height) || 50;
                const newHeight = baseHeight * (0.5 + intensity * 0.5);
                bar.style.height = `${newHeight}%`;
            });
        }
        
        // Clear existing timeout
        if (activityTimeout) clearTimeout(activityTimeout);
        
        // Reset after 2 seconds of no activity
        activityTimeout = setTimeout(() => {
            visualizerStatus.textContent = 'No Activity';
            visualizerStatus.style.color = '#71717a';
        }, 2000);
    }

    // --- Animation Functions ---
    function startWaveformAnimation() {
        if (waveformInterval) return;
        
        waveformInterval = setInterval(() => {
            if (!isCapturing) return;
            
            waveformBars.forEach(bar => {
                const height = Math.random() * 80 + 10; // 10-90%
                bar.style.height = height + '%';
            });
        }, 150);
    }

    function stopWaveformAnimation() {
        if (waveformInterval) {
            clearInterval(waveformInterval);
            waveformInterval = null;
        }
        
        // Reset bars to low position
        waveformBars.forEach(bar => {
            bar.style.height = '20%';
        });
    }

    function flashElement(element) {
        element.style.animation = 'none';
        setTimeout(() => {
            element.style.animation = 'slideIn 0.3s ease-out';
        }, 10);
    }

    // --- Helper Functions ---
    function handleCopyTranscripts() {
        chrome.runtime.sendMessage({ type: 'getTranscriptions' }, response => {
            if (response && response.transcriptions && response.transcriptions.length > 0) {
                const text = response.transcriptions
                    .map(t => `[${new Date(t.timestamp).toLocaleTimeString()}] ${t.speaker || 'Speaker'}: ${t.text}`)
                    .join('\n');
                
                navigator.clipboard.writeText(text).then(() => {
                    showNotification('Transcripts copied to clipboard!', 'success');
                    animateButton(copyBtn);
                }, () => {
                    showNotification('Failed to copy transcripts.', 'error');
                });
            } else {
                showNotification('No transcripts to copy.', 'error');
            }
        });
    }

    function handleExport(scope) {
        exportBtn.disabled = true;
        const originalText = exportBtn.innerHTML;
        exportBtn.innerHTML = '<span>⏳</span> Exporting...';

        chrome.runtime.sendMessage({ type: 'getMarkdown', scope: scope }, response => {
            if (response && response.markdown) {
                const fileName = `vtf-${scope}-${new Date().toISOString().split('T')[0]}.md`;
                downloadFile(response.markdown, fileName, 'text/markdown');
                showNotification(`${scope.charAt(0).toUpperCase() + scope.slice(1)} exported successfully!`, 'success');
                animateButton(exportBtn);
            } else {
                showNotification('Failed to generate export.', 'error');
            }
            
            exportBtn.disabled = false;
            exportBtn.innerHTML = originalText;
        });
    }

    function downloadFile(content, fileName, contentType) {
        const blob = new Blob([content], { type: contentType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'error' ? '#ef4444' : '#22c55e'};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 1000;
            animation: slideIn 0.3s ease-out;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        `;
        
        document.body.appendChild(notification);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }

    function animateButton(button) {
        button.style.transform = 'scale(0.95)';
        setTimeout(() => {
            button.style.transform = '';
        }, 100);
    }

    // --- Add slideOut animation ---
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideOut {
            from { opacity: 1; transform: translateX(0); }
            to { opacity: 0; transform: translateX(20px); }
        }
    `;
    document.head.appendChild(style);

    // Display version number
    const manifest = chrome.runtime.getManifest();
    versionInfo.textContent = `v${manifest.version}`;
});