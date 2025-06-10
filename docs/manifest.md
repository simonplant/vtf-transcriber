# Manifest Configuration

The `manifest.json` file defines the core configuration and permissions for the VTF Audio Transcriber Chrome extension.

## Basic Information

```json
{
  "manifest_version": 3,
  "name": "VTF Audio Transcriber",
  "version": "0.7.0",
  "description": "Captures and transcribes audio from browser tabs using the tabCapture API"
}
```

## Permissions

The extension requires the following permissions:

- `storage`: For saving user preferences and API keys
- `notifications`: For displaying transcription results
- `tabCapture`: For capturing audio from browser tabs
- `offscreen`: For handling audio recording in a separate context

## Components

### Background Service Worker
```json
{
  "background": {
    "service_worker": "background.js",
    "type": "module"
  }
}
```
The service worker manages the tab capture process and communicates with the offscreen document.

### User Interface
```json
{
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  }
}
```
The popup provides controls for starting and stopping recording.

### Options Page
```json
{
  "options_page": "options.html"
}
```
The options page allows users to configure API keys and other settings.

### Offscreen Document
```json
{
  "offscreen": {
    "page": "offscreen.html",
    "reason": "AUDIO_CAPTURE"
  }
}
```
The offscreen document handles audio recording and processing.

## Icons

The extension uses the following icon sizes:
- 16x16: Used in the extension management page
- 32x32: Used in Windows taskbar
- 48x48: Used in the Chrome Web Store
- 128x128: Used in the Chrome Web Store and installation

## API Access

The extension requires access to the OpenAI API:
```json
{
  "host_permissions": [
    "https://api.openai.com/*"
  ]
}
```

## Security Considerations

1. The extension uses Manifest V3 for enhanced security
2. API keys are stored securely in Chrome's storage
3. No code is injected into target pages
4. Audio capture is handled in an isolated offscreen context 