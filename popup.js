const apiKeyInput = document.getElementById('apiKey');
const saveButton = document.getElementById('saveKey');
const statusElement = document.getElementById('status');
const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');

// Load existing key to show it's set (but don't display the key)
document.addEventListener('DOMContentLoaded', async () => {
  const data = await chrome.storage.local.get(['openaiApiKey']);
  if (data.openaiApiKey) {
    apiKeyInput.placeholder = "API Key is set";
  }
});

saveButton.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value;
  if (apiKey) {
    await chrome.storage.local.set({ openaiApiKey: apiKey });
    statusElement.textContent = 'API Key saved!';
    apiKeyInput.value = '';
    apiKeyInput.placeholder = "API Key is set";
    setTimeout(() => statusElement.textContent = '', 2000);
  } else {
    statusElement.textContent = 'Please enter a key.';
  }
});

// Send a message to start capture
startButton.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.runtime.sendMessage({ type: 'startCapture', tabId: tab.id });
  window.close();
});

// Send a message to stop capture
stopButton.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.runtime.sendMessage({ type: 'stopCapture', tabId: tab.id });
  window.close();
});

// Check the status when the popup opens
document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getStatus', tabId: tab.id });
    if (response && response.isActive) {
      statusElement.textContent = `Status: Capturing ${response.streams} streams.`;
      startButton.style.display = 'none';
      stopButton.style.display = 'block';
    }
  } catch (e) {
    statusElement.textContent = 'Status: Ready to start.';
    // This can happen if the service worker isn't active yet, which is normal.
  }
});