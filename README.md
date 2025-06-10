# VTF Audio Transcriber

A Chrome extension that captures and transcribes audio from browser tabs using the tabCapture API and OpenAI's Whisper model.

## Features

- Capture audio from any browser tab
- Real-time transcription using OpenAI's Whisper model
- Clean, non-intrusive interface
- Secure API key storage
- No code injection into target pages

## Installation

1. Download the latest release from the [Chrome Web Store](https://chrome.google.com/webstore/detail/vtf-audio-transcriber/...)
2. Click "Add to Chrome" to install the extension

## Usage

1. Click the extension icon in your browser toolbar
2. Click "Start Recording" to begin capturing audio
3. The extension will automatically transcribe the audio and show notifications
4. Click "Stop Recording" when you're done

## Configuration

1. Click the extension icon
2. Click the gear icon to open settings
3. Enter your OpenAI API key
4. Save your settings

## Development

1. Clone the repository:
   ```bash
   git clone https://github.com/simonplant/vtf-transcriber.git
   cd vtf-transcriber
   ```

2. Load the extension in Chrome:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `src` directory

3. Make changes to the source files in the `src` directory
4. The extension will automatically reload when you make changes

For more detailed development information, see the [Development Guide](docs/development.md).

## Architecture

The extension uses a modern architecture based on Chrome's tabCapture API and Offscreen Documents. See the [Architecture Documentation](docs/architecture.md) for details.

## Security

- No code is injected into target pages
- API keys are stored securely in Chrome's storage
- Audio capture is handled in an isolated offscreen context
- All communication is done through Chrome's messaging system

## License

MIT License - see LICENSE file for details

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Support

For issues and feature requests, please use the [GitHub issue tracker](https://github.com/simonplant/vtf-transcriber/issues).