# VTF Audio Transcriber Chrome Extension Makefile

# === Configuration ===
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
CYAN := \033[0;36m
GREEN := \033[0;32m
RED := \033[0;31m
NC := \033[0m # No Color

.PHONY: all dev dist clean help package

# === Core Targets ===

# Default target
all: help

# Package the extension into a zip file for distribution
package:
	@echo "$(CYAN)Packaging extension v$(VERSION)...$(NC)"
	@mkdir -p release
	@cd src && zip -r ../release/$(EXTENSION_NAME)-v$(VERSION).zip . -x "*.DS_Store" || (echo "$(RED)Packaging failed$(NC)" && exit 1)
	@echo "$(GREEN)Extension packaged: release/$(EXTENSION_NAME)-v$(VERSION).zip$(NC)"

# Remove generated files
clean:
	@echo "$(CYAN)Cleaning release artifacts...$(NC)"
	@rm -rf release
	@echo "$(GREEN)Clean complete!$(NC)"

# Load the extension in a new Chrome instance for testing
load:
	@echo "$(CYAN)Loading extension in Chrome from ./src folder...$(NC)"
	@if [ ! -d "src" ]; then \
		echo "$(RED)Error: src directory not found.$(NC)"; \
		exit 1; \
	fi
	@if [ ! -f "$(CHROME_PATH)" ]; then \
		echo "$(RED)Error: Chrome not found at $(CHROME_PATH)$(NC)"; \
		exit 1; \
	fi
	@$(CHROME_PATH) --load-extension=$(shell pwd)/src --enable-logging --v=1

# Display this help message
help:
	@echo "VTF Audio Transcriber - Makefile Commands"
	@echo ""
	@echo "Development:"
	@echo "  $(GREEN)make dev$(NC)      - Instructions for loading extension in development mode"
	@echo ""
	@echo "Distribution:"
	@echo "  $(GREEN)make dist$(NC)     - Create zip package for Chrome Web Store submission"
	@echo ""
	@echo "Maintenance:"
	@echo "  $(GREEN)make clean$(NC)    - Remove generated files"
	@echo "  $(GREEN)make help$(NC)     - Show this help message"

# Development commands
dev:
	@echo "Loading extension in development mode..."
	@echo "1. Open Chrome and go to chrome://extensions/"
	@echo "2. Enable 'Developer mode'"
	@echo "3. Click 'Load unpacked' and select the 'src' directory"

# Distribution commands
dist:
	@echo "Creating distribution package..."
	@mkdir -p release
	@cd src && zip -r ../release/vtf-transcriber.zip . -x "*.DS_Store" "*.git*"
	@echo "Package created at release/vtf-transcriber.zip"
