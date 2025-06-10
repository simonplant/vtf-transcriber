# NPM Scripts Documentation

This document describes the available npm scripts in the VTF Transcriber Chrome extension.

## Build Scripts

### `npm run build`
Builds the extension using webpack.
- Uses the webpack configuration from `webpack.config.js`
- Outputs to the `dist` directory
- Automatically runs clean and validate scripts

### `npm run dev`
Starts development mode with hot reloading.
- Watches for file changes
- Uses development mode configuration
- Enables source maps for debugging

### `npm run clean`
Cleans build artifacts.
- Removes `dist` directory
- Removes `release` directory
- Uses rimraf for cross-platform compatibility

### `npm run validate`
Validates the extension build.
- Runs the validation script
- Checks for required files
- Verifies manifest.json
- Ensures all paths are correct

### `npm run lint`
Runs ESLint to check code quality.
- Lints all JavaScript files in `src`
- Uses project's ESLint configuration
- Helps maintain code standards

## Lifecycle Scripts

### `npm run prebuild`
Automatically runs before the build script.
- Cleans the build directory
- Ensures a fresh build

### `npm run postbuild`
Automatically runs after the build script.
- Validates the build
- Ensures build quality

## Test Scripts

### `npm test`
Currently a placeholder for future test implementation.
- Will be used for unit tests
- Will be used for integration tests
- Will be used for end-to-end tests

## Environment Requirements

The extension requires:
- Node.js version 14.0.0 or higher
- npm version 6.0.0 or higher

These requirements are specified in the `engines` field of `package.json`. 