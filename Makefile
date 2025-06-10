# VTF Transcriber Chrome Extension Makefile

# === Configuration ===
# Use ?= to allow overriding from the command line (e.g., make prod NODE_ENV=production)
NODE_ENV ?= development
EXTENSION_NAME ?= vtf-transcriber
VERSION := $(shell jq -r .version manifest.json)

# Cross-platform path for Google Chrome
ifeq ($(OS),Windows_NT)
	CHROME_PATH ?= "C:\Program Files\Google\Chrome\Application\chrome.exe"
else ifeq ($(shell uname),Linux)
	CHROME_PATH ?= google-chrome
else # Default to macOS
	CHROME_PATH ?= "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
endif

# === Cosmetics ===
# Colors for terminal output
CYAN := \033[0;36m
GREEN := \033[0;32m
RED := \033[0;31m
NC := \033[0m # No Color

.PHONY: all build clean install dev test lint help prod package release load

# === Core Targets ===

# Default target
all: build

# Install all project dependencies
install:
	@echo "$(CYAN)Installing dependencies...$(NC)"
	@npm install
	@echo "$(GREEN)Dependencies installed!$(NC)"

# Build the extension for development
build:
	@echo "$(CYAN)Building extension for $(NODE_ENV)...$(NC)"
	@npm run build
	@echo "$(GREEN)Build complete!$(NC)"

# Start the development watch server
dev:
	@echo "$(CYAN)Starting development watcher...$(NC)"
	@npm run watch

# Create a production-ready build
prod:
	@echo "$(CYAN)Creating production build...$(NC)"
	@NODE_ENV=production $(MAKE) build
	@echo "$(GREEN)Production build complete!$(NC)"

# Package the extension into a zip file for distribution
package: prod
	@echo "$(CYAN)Packaging extension v$(VERSION)...$(NC)"
	@mkdir -p release
	@cd dist && zip -r ../release/$(EXTENSION_NAME)-v$(VERSION).zip . -x "*.DS_Store"
	@echo "$(GREEN)Extension packaged: release/$(EXTENSION_NAME)-v$(VERSION).zip$(NC)"

# Alias for 'package'
release: package

# === Utility Targets ===

# Run linters on the codebase
lint:
	@echo "$(CYAN)Linting code...$(NC)"
	@npm run lint

# Run the test suite
test:
	@echo "$(CYAN)Running tests...$(NC)"
	@npm test

# Remove generated files
clean:
	@echo "$(CYAN)Cleaning build artifacts...$(NC)"
	@rm -rf dist/
	@rm -rf release/
	@echo "$(GREEN)Clean complete!$(NC)"

# Load the extension in a new Chrome instance for testing
load: build
	@echo "$(CYAN)Loading extension in Chrome from ./dist folder...$(NC)"
	@$(CHROME_PATH) --load-extension=$(shell pwd)/dist --enable-logging --v=1

# Display this help message
help:
	@echo "$(CYAN)VTF Transcriber Chrome Extension Makefile$(NC)"
	@echo ""
	@echo "Usage:"
	@echo "  $(GREEN)make $(NC)          - Build the extension for development (default)"
	@echo "  $(GREEN)make install$(NC)  - Install dependencies via npm"
	@echo "  $(GREEN)make dev$(NC)      - Start development mode with file watching"
	@echo "  $(GREEN)make prod$(NC)     - Create a minified production build"
	@echo "  $(GREEN)make package$(NC)  - Create a production build and zip it for release"
	@echo ""
	@echo "Utilities:"
	@echo "  $(GREEN)make clean$(NC)    - Remove all generated build and release files"
	@echo "  $(GREEN)make lint$(NC)     - Run the linter"
	@echo "  $(GREEN)make test$(NC)     - Run the test suite"
	@echo "  $(GREEN)make load$(NC)     - Open Chrome with the extension loaded (requires build)"
	@echo "  $(GREEN)make help$(NC)     - Show this help message" 