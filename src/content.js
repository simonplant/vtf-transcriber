// Content script for VTF Audio Transcriber
console.log('[VTF] Content script loaded');

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[VTF] Received message:', message);
    
    if (message.type === 'log') {
        console.log(`[VTF] ${message.message}`, message.data || '');
    }
    
    sendResponse({ received: true });
    return true;
});

// Notify that we're ready
chrome.runtime.sendMessage({ type: 'content-script-ready' }); 