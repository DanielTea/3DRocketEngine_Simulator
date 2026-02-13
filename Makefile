.PHONY: setup run test clean

setup:
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
	mkdir -p frontend/lib
	cd frontend/lib && \
		curl -sL -o three.module.min.js "https://unpkg.com/three@0.168.0/build/three.module.min.js" && \
		curl -sL -o OrbitControls.js "https://unpkg.com/three@0.168.0/examples/jsm/controls/OrbitControls.js"

run:
	cd backend && .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload

test:
	cd backend && .venv/bin/python -m pytest tests/ -v

clean:
	rm -rf backend/.venv backend/__pycache__ backend/**/__pycache__
