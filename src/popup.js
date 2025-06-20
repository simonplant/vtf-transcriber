/**
 * @file popup.js
 * @path src/popup.js
 * @description Dashboard interface for real-time monitoring and control of VTF audio transcription
 * @modified 2024-07-26
 */

document.addEventListener('DOMContentLoaded', () => {

    // DOM elements
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const copyBtn = document.getElementById('copyBtn');
    const exportBtn = document.getElementById('exportBtn');
    const dailyExportBtn = document.getElementById('dailyExportBtn');
    const statusIndicator = document.getElementById('statusIndicator');
    const captureStatusSpan = document.querySelector('#captureStatus span');
    const transcriptionCountEl = document.getElementById('transcriptionCount');
    const lastTranscriptionEl = document.getElementById('lastTranscription');
    const errorMessageEl = document.getElementById('errorMessage');
    const successMessageEl = document.getElementById('successMessage');
    const activeSpeakersEl = document.getElementById('activeSpeakers');

    // --- Event Handlers ---

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.type) {
            case 'statusUpdate':
                if (message.status) updateUI(message.status);
                break;
            case 'transcriptionsUpdate':
                if (message.transcriptions) updateTranscriptionDisplay(message.transcriptions);
                break;
            case 'error':
                showError(message.message);
                break;
        }
    });

    if (startBtn) {
        startBtn.addEventListener('click', () => {
            chrome.storage.local.get(['openaiApiKey'], (result) => {
                if (!result.openaiApiKey) {
                    showError('API Key not set. Please go to the options page.');
                    return;
                }
                chrome.runtime.sendMessage({ type: 'startCapture', apiKey: result.openaiApiKey });
            });
        });
    }

    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: 'stopCapture' });
        });
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', () => handleExport('session'));
    }

    if (dailyExportBtn) {
        dailyExportBtn.addEventListener('click', () => handleExport('daily'));
    }

    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: 'getTranscriptions' }, response => {
                if (response && response.transcriptions && response.transcriptions.length > 0) {
                    const text = response.transcriptions.map(t => `[${new Date(t.timestamp).toLocaleTimeString()}] ${t.speaker}: ${t.text}`).join('\n');
                    navigator.clipboard.writeText(text).then(() => showSuccess('Copied to clipboard!'), () => showError('Failed to copy.'));
                } else {
                    showError('No transcriptions to copy.');
                }
            });
        });
    }

    // --- UI Update Functions ---

    function updateUI(status) {
        if (status.isCapturing) {
            if (statusIndicator) statusIndicator.classList.add('active', 'capturing');
            if (captureStatusSpan) captureStatusSpan.textContent = 'Capturing';
            if (startBtn) startBtn.disabled = true;
            if (stopBtn) stopBtn.disabled = false;
        } else {
            if (statusIndicator) statusIndicator.classList.remove('active', 'capturing');
            if (captureStatusSpan) captureStatusSpan.textContent = 'Not Capturing';
            if (startBtn) startBtn.disabled = false;
            if (stopBtn) stopBtn.disabled = true;
        }

        if (transcriptionCountEl) transcriptionCountEl.textContent = status.transcriptionCount || 0;
        if (activeSpeakersEl) activeSpeakersEl.textContent = status.activeSpeakers || 0;
    }

    function updateTranscriptionDisplay(transcriptions) {
        if (transcriptionCountEl) transcriptionCountEl.textContent = transcriptions.length;

        if (transcriptions.length > 0) {
            const last = transcriptions[transcriptions.length - 1];
            if (lastTranscriptionEl) lastTranscriptionEl.textContent = `[${new Date(last.timestamp).toLocaleTimeString()}] ${last.speaker}: ${last.text}`;
        } else {
            if (lastTranscriptionEl) lastTranscriptionEl.textContent = 'No transcriptions yet.';
        }
    }

    function showError(message) {
        if (!errorMessageEl) return;
        errorMessageEl.textContent = message;
        errorMessageEl.classList.remove('vtf-hidden');
        setTimeout(() => { if (errorMessageEl) errorMessageEl.classList.add('vtf-hidden'); }, 5000);
    }

    function showSuccess(message) {
        if (!successMessageEl) return;
        successMessageEl.textContent = message;
        successMessageEl.classList.remove('vtf-hidden');
        setTimeout(() => { if (successMessageEl) successMessageEl.classList.add('vtf-hidden'); }, 3000);
    }

    // --- Helper Functions ---

    function handleExport(scope) {
        const btn = scope === 'session' ? exportBtn : dailyExportBtn;
        if(btn) {
            btn.disabled = true;
            btn.textContent = 'Exporting...';
        }

        chrome.runtime.sendMessage({ type: 'getMarkdown', scope: scope }, response => {
            if (response && response.markdown) {
                const fileName = `vtf-${scope}-${new Date().toISOString().split('T')[0]}.md`;
                downloadFile(response.markdown, fileName, 'text/markdown');
                showSuccess(`${scope.charAt(0).toUpperCase() + scope.slice(1)} exported.`);
            } else {
                showError('Failed to generate export.');
            }
             if(btn) {
                btn.disabled = false;
                btn.textContent = scope === 'session' ? 'Export Session' : 'Export Daily';
            }
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
    
    // --- Initial State Request ---
    chrome.runtime.sendMessage({ type: 'getStatus' });
    chrome.runtime.sendMessage({ type: 'getTranscriptions' });
}); 