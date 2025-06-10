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

.PHONY: all clean load help package

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
	@echo "$(CYAN)VTF Audio Transcriber Chrome Extension Makefile$(NC)"
	@echo ""
	@echo "Usage:"
	@echo "  $(GREEN)make package$(NC)  - Create a zip file of the extension for distribution"
	@echo "  $(GREEN)make clean$(NC)    - Remove all generated release files"
	@echo "  $(GREEN)make load$(NC)     - Open Chrome with the extension loaded from src directory"
	@echo "  $(GREEN)make help$(NC)     - Show this help message"
