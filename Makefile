# VTF Audio Transcriber Chrome Extension Makefile
#
# A streamlined Makefile for modern Chrome Extension development.
# This file focuses on a simple, efficient build-and-reload workflow.

# === Configuration ===
# Reads the version directly from your manifest file.
VERSION := $(shell jq -r .version manifest.json)

# === Cosmetics ===
CYAN    := \033[0;36m
GREEN   := \033[0;32m
RED     := \033[0;31m
NC      := \033[0m # No Color

# === Target Definitions ===
# Declares targets that are not files.
.PHONY: all watch dist clean help dev

# --- Core Targets ---

# Default target runs when you just type 'make'.
all: help

# Fail-safe for the old, removed 'dev' command.
dev:
	@echo "$(RED)Error: The 'make dev' command has been removed.$(NC)"
	@echo "Please use the new development command: $(GREEN)make watch$(NC)"
	@echo "This new command will automatically rebuild the extension when you save changes."
	@exit 1

# The new development command.
# This task watches for file changes and automatically rebuilds the extension.
# It requires 'entr' to be installed (http://eradman.com/entrproject/).
#
# On macOS: brew install entr
# On Debian/Ubuntu: sudo apt-get install entr
#
watch: dist ## ✨ Start the development watcher to auto-rebuild on file changes.
	@if ! command -v entr &> /dev/null; then \
		echo "$(RED)Error: 'entr' is not installed. It is required for 'make watch'.$(NC)"; \
		echo "To install, run: $(CYAN)brew install entr$(NC) (macOS) or $(CYAN)sudo apt-get install entr$(NC) (Debian/Ubuntu)"; \
		exit 1; \
	fi
	@echo "$(GREEN)✓ Watching for changes. Press Ctrl+C to exit.$(NC)"
	@echo "  Load the '$(CYAN)dist/$(NC)' directory in Chrome via 'Load unpacked'."
	@echo "  After saving changes, just reload the extension in your browser."
	@find src icons manifest.json | entr -c make dist

# Creates a clean, loadable extension in the 'dist/' directory.
# This is what you'll load into Chrome.
dist: clean ## 📦 Build the extension for distribution into the 'dist/' folder.
	@echo "$(CYAN)Creating distribution directory...$(NC)"
	@mkdir -p dist
	@cp manifest.json dist/
	@cp -r src/* dist/
	@cp -r icons dist/
	@# Remove unwanted development files from the final build
	@find dist -name ".DS_Store" -delete
	@find dist -name "QA_TESTING_CHECKLIST.md" -delete
	@echo "$(GREEN)✓ Extension built successfully in 'dist/' directory!$(NC)"

# Removes the generated 'dist/' directory.
clean: ## 🧹 Remove the 'dist/' directory.
	@echo "$(CYAN)Cleaning build artifacts...$(NC)"
	@rm -rf dist
	@echo "$(GREEN)✓ Clean complete!$(NC)"

# Displays a helpful list of commands.
help: ## 🆘 Show this help message.
	@echo "Makefile Commands"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@# This AWK script nicely formats the comments next to the targets.
	@awk 'BEGIN {FS = "## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[0;32m%-10s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)