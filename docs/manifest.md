# Manifest.json Documentation

This document describes the configuration and permissions used in the VTF Transcriber Chrome extension.

## Extension Metadata

```json
{
    "manifest_version": 3,
    "name": "VTF Audio Transcriber",
    "version": "0.7.0",
    "description": "Captures and transcribes audio from the VTF platform using a direct stream integration."
}
```

## Permissions

The extension requires the following permissions:

- `storage`: Used for saving user preferences and settings
- `activeTab`: Required for accessing the current tab's content
- `scripting`: Required for injecting content scripts
- `notifications`: Used for showing transcription status updates

## Host Permissions

The extension requires access to:

- `*://vtf.t3live.com/*`: For accessing the VTF platform
- `https://api.openai.com/*`: For accessing the Whisper API

## Background Service Worker

The extension uses a background service worker (`dist/background.js`) to handle:
- Extension events
- State management
- Communication between components

## Extension UI

The extension provides:
- A popup interface (`dist/popup.html`) for quick access to controls
- Icons in multiple sizes (16px, 48px, 128px) for various contexts

## Web Accessible Resources

The following resources are made accessible to web pages:

- `dist/audio-worklet.js`: Audio processing worker for handling audio streams
- `dist/content.bundle.js`: Content script bundle for page integration

These resources are only accessible on the VTF platform (`*://vtf.t3live.com/*`).

## Options Page

The extension includes an options page (`dist/options.html`) for:
- API key configuration
- Language settings
- Duration limits
- Other user preferences 