PYTHON := /opt/conda/bin/python3
BACKEND_DIR := src/backend
FRONTEND_DIR := src/frontend
PYTHONPATH := $(shell pwd)/$(BACKEND_DIR)

.PHONY: install dev-backend dev-frontend test benchmark seed clean help

help:
	@echo "AI Emergency Operations & Resource Orchestration System"
	@echo ""
	@echo "Commands:"
	@echo "  make install      Install all dependencies"
	@echo "  make dev          Start backend + frontend (use two terminals)"
	@echo "  make dev-backend  Start backend only (port 8000)"
	@echo "  make test         Run all tests"
	@echo "  make benchmark    Run benchmark and print results"
	@echo "  make seed         Reset and seed the database"
	@echo "  make clean        Remove generated files"

install:
	cd $(BACKEND_DIR) && $(PYTHON) -m pip install -r requirements.txt -q
	cd $(FRONTEND_DIR) && npm install --legacy-peer-deps

dev-backend:
	cd $(BACKEND_DIR) && PYTHONPATH=$(PYTHONPATH) $(PYTHON) -m uvicorn app.main:app --reload --port 8000 --host 0.0.0.0

dev-frontend:
	cd $(FRONTEND_DIR) && npm run dev

dev: install
	@echo "Start backend: make dev-backend"
	@echo "Start frontend: make dev-frontend"
	@echo "(Run each in a separate terminal)"

test:
	@rm -f $(BACKEND_DIR)/disaster_response.db
	cd $(BACKEND_DIR) && PYTHONPATH=$(PYTHONPATH) $(PYTHON) -m pytest tests/ -v --tb=short

benchmark:
	@echo "Starting backend temporarily for benchmark..."
	cd $(BACKEND_DIR) && PYTHONPATH=$(PYTHONPATH) $(PYTHON) benchmark_runner.py

seed:
	@rm -f $(BACKEND_DIR)/disaster_response.db
	cd $(BACKEND_DIR) && PYTHONPATH=$(PYTHONPATH) $(PYTHON) seed_runner.py

build-frontend:
	cd $(FRONTEND_DIR) && npm run build

clean:
	rm -f $(BACKEND_DIR)/disaster_response.db
	rm -f $(BACKEND_DIR)/benchmark_results.json
	rm -rf $(FRONTEND_DIR)/dist
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true
