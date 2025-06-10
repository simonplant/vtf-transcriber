# Webpack Configuration Documentation

This document describes the build configuration for the VTF Transcriber Chrome extension.

## Overview

The webpack configuration is designed to:
- Build the extension for both development and production
- Optimize the build process with caching and code splitting
- Handle different file types and resources
- Generate source maps for debugging

## Entry Points

The extension has four main entry points:
- `content.js`: Content script for page integration
- `background.js`: Background service worker
- `options.js`: Options page logic
- `popup.js`: Extension popup interface

## Build Modes

### Development Mode
- Source maps enabled for debugging
- No code minification
- Faster build times
- Hot module replacement

### Production Mode
- Minified output
- Optimized chunks
- Source maps for error tracking
- Vendor code splitting

## Optimization Features

### Code Splitting
- Vendor code is split into separate chunks
- Reduces main bundle size
- Improves caching

### Caching
- Filesystem-based caching
- Faster rebuilds
- Cache invalidation on config changes

### Source Maps
- Development: `eval-source-map` for fast builds
- Production: `source-map` for error tracking

## Module Rules

### JavaScript Processing
- Babel transpilation
- Node modules excluded
- Cache directory enabled

## Plugins

### CleanWebpackPlugin
- Cleans the output directory before each build
- Prevents stale files

### CopyPlugin
- Copies static assets:
  - manifest.json
  - HTML files
  - Icons
  - Audio worklet

## Watch Options
- Ignores node_modules
- 300ms aggregate timeout
- Prevents excessive rebuilds

## Output Configuration
- Output to `dist` directory
- Background script without bundle suffix
- Other files with bundle suffix
- Clean output directory before build 