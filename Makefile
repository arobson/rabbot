.DEFAULT_GOAL := help

.PHONY: help build build-clean test test-unit test-integration test-watch coverage typecheck clean \
        install docker-build docker-create docker-start docker-stop docker-remove docker-bootstrap

help: ## Show this help message
	@echo ""
	@echo "rabbot - RabbitMQ abstraction library"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'
	@echo ""

install: ## Install all dependencies
	npm install

build: ## Compile TypeScript to dist/
	npm run build

build-clean: ## Clean dist/ and recompile TypeScript
	npm run build:clean

test: ## Run unit tests (spec/behavior)
	npm test

test-unit: ## Run unit tests only
	npm run test:unit

test-integration: ## Run integration tests (requires RabbitMQ)
	npm run test:integration

test-watch: ## Run unit tests in watch mode
	npm run test:watch

coverage: ## Run unit tests with coverage report
	npm run coverage

typecheck: ## Type-check without emitting output
	npm run typecheck

clean: ## Remove compiled output (dist/)
	npm run clean

docker-build: ## Build the RabbitMQ Docker image
	npm run build-image

docker-create: ## Create and start a RabbitMQ Docker container
	npm run create-container

docker-bootstrap: ## Build image and create container
	npm run bootstrap-container

docker-start: ## Start the existing RabbitMQ container
	npm run start-container

docker-stop: ## Stop the RabbitMQ container
	npm run stop-container

docker-remove: ## Remove the RabbitMQ container
	npm run remove-container
