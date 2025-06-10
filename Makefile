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

.PHONY: all dev dist clean help

# === Core Targets ===

# Default target
all: help

# Create distribution directory for Chrome extension
dist:
	@echo "$(CYAN)Creating distribution directory...$(NC)"
	@rm -rf dist
	@mkdir -p dist
	@cp -r src/* dist/
	@cp manifest.json dist/
	@cp -r icons dist/
	@find dist -name ".DS_Store" -delete
	@find dist -name ".git*" -delete
	@echo "$(GREEN)Distribution directory created at ./dist$(NC)"
	@echo "$(CYAN)You can now load this extension in Chrome:$(NC)"
	@echo "1. Open Chrome and go to chrome://extensions/"
	@echo "2. Enable 'Developer mode'"
	@echo "3. Click 'Load unpacked' and select the 'dist' directory"

# Remove generated files
clean:
	@echo "$(CYAN)Cleaning distribution directory...$(NC)"
	@rm -rf dist
	@echo "$(GREEN)Clean complete!$(NC)"

# Load the extension in a new Chrome instance for testing
load:
	@echo "$(CYAN)Loading extension in Chrome from ./dist folder...$(NC)"
	@if [ ! -d "dist" ]; then \
		echo "$(RED)Error: dist directory not found. Run 'make dist' first.$(NC)"; \
		exit 1; \
	fi
	@if [ ! -f "$(CHROME_PATH)" ]; then \
		echo "$(RED)Error: Chrome not found at $(CHROME_PATH)$(NC)"; \
		exit 1; \
	fi
	@$(CHROME_PATH) --load-extension=$(shell pwd)/dist --enable-logging --v=1

# Development mode with hot reloading
dev:
	@echo "$(CYAN)Starting development mode...$(NC)"
	@if [ ! -d "src" ]; then \
		echo "$(RED)Error: src directory not found.$(NC)"; \
		exit 1; \
	fi
	@if [ ! -f "$(CHROME_PATH)" ]; then \
		echo "$(RED)Error: Chrome not found at $(CHROME_PATH)$(NC)"; \
		exit 1; \
	fi
	@echo "$(GREEN)Starting Chrome in development mode...$(NC)"
	@echo "$(CYAN)Instructions:$(NC)"
	@echo "1. Chrome will open with the extension loaded"
	@echo "2. Make changes to files in the src directory"
	@echo "3. Click the refresh icon in chrome://extensions/"
	@echo "4. Press Ctrl+C to stop the development server"
	@$(CHROME_PATH) --load-extension=$(shell pwd)/src --enable-logging --v=1 --user-data-dir="$(shell pwd)/chrome-dev-profile" &

# Display this help message
help:
	@echo "VTF Audio Transcriber - Makefile Commands"
	@echo ""
	@echo "Development:"
	@echo "  $(GREEN)make dev$(NC)     - Start development mode with hot reloading"
	@echo "  $(GREEN)make dist$(NC)    - Create distribution directory for Chrome extension"
	@echo "  $(GREEN)make load$(NC)    - Load extension in Chrome for testing"
	@echo ""
	@echo "Maintenance:"
	@echo "  $(GREEN)make clean$(NC)   - Remove distribution directory"
	@echo "  $(GREEN)make help$(NC)    - Show this help message"
