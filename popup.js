const apiKeyInput = document.getElementById('apiKey');
const saveButton = document.getElementById('saveKey');
const statusElement = document.getElementById('status');

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