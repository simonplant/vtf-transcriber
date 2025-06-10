# VTF Transcriber Chrome Extension

A Chrome extension for transcribing VTF audio streams using OpenAI's Whisper API.

## Features

- Real-time audio capture from VTF streams
- Transcription using OpenAI's Whisper API
- Chat-style transcription display
- Configurable settings via options page
- Support for multiple languages
- Source maps for debugging
- Build caching for faster development
- Comprehensive error handling and validation

## Development Setup

### Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- Google Chrome

### Installation

1. Clone the repository:
```bash
git clone https://github.com/simonplant/vtf-transcriber.git
cd vtf-transcriber
```

2. Install dependencies:
```bash
make install
```

### Development Workflow

1. Start development mode with hot reloading:
```bash
make dev
```

2. Build the extension:
```bash
make build
```

3. Load the extension in Chrome:
```bash
make load
```

### Build Commands

- `make install` - Install all project dependencies
- `make build` - Build the extension for development
- `make dev` - Start development mode with file watching
- `make prod` - Create a minified production build
- `make package` - Create a production build and zip it for release
- `make clean` - Remove all generated build and release files
- `make validate` - Validate the extension build
- `make load` - Open Chrome with the extension loaded (requires build)
- `make lint` - Run ESLint to check code quality
- `make check-deps` - Verify Node.js and npm versions

### Project Structure

```
vtf-transcriber/
├── src/                    # Source code
│   ├── background.js      # Background service worker
│   ├── content.js         # Content script
│   ├── popup.js          # Extension popup
│   ├── popup.html        # Popup UI
│   ├── options.js        # Options page logic
│   ├── options.html      # Options page UI
│   ├── audio-worklet.js  # Audio processing
│   ├── transcription-ui.js # Transcription display
│   ├── vtf-audio-capture.js # Audio capture logic
│   ├── vtf-globals-finder.js # VTF global detection
│   └── vtf-stream-monitor.js # Stream monitoring
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── scripts/              # Build scripts
│   └── validate-extension.js # Build validation
├── dist/                 # Build output (gitignored)
├── release/             # Release packages (gitignored)
├── LICENSE
├── Makefile            # Build automation
├── manifest.json       # Extension manifest
├── package.json        # Project configuration
├── README.md
└── webpack.config.js   # Build configuration
```

### Build System Features

- **Source Maps**: Enabled in development for better debugging
- **Build Caching**: Filesystem-based caching for faster rebuilds
- **Code Splitting**: Vendor code is split into separate chunks
- **Optimization**: Production builds are minified and optimized
- **Validation**: Automatic validation of builds before completion
- **Error Handling**: Comprehensive error checking and reporting

### Configuration

The extension can be configured through the options page:

1. Open Chrome Extensions (chrome://extensions)
2. Find VTF Transcriber and click "Options"
3. Configure:
   - API Key
   - API Endpoint
   - Default Language
   - Maximum Duration

### Building for Production

1. Create a production build:
```bash
make prod
```

2. Package for distribution:
```bash
make package
```

The packaged extension will be available in the `release` directory.

### Troubleshooting

If you encounter issues loading the extension:

1. Clean the build:
```bash
make clean
```

2. Rebuild:
```bash
make build
```

3. Validate the build:
```bash
make validate
```

4. Load in Chrome:
```bash
make load
```

Common issues:
- Missing dependencies: Run `make install`
- Invalid build: Run `make clean && make build`
- Chrome loading issues: Ensure Chrome is closed before running `make load`
- Version mismatch: Run `make check-deps` to verify Node.js and npm versions

## License

ISC

## Author

Simon Plant