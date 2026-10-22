"""
CHĀTURANGA Phase 2 — Server Entry Point
Runs Flask API server on port 5000.
"""

import os
import sys

# Ensure project root is in python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

from backend.app import create_app

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"Starting CHATURANGA Phase 2 Flask Backend on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
