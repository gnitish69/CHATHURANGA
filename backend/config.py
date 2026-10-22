"""
CHĀTURANGA Phase 3 — Backend Configuration
"""

import os

# Stockfish path: check environment variable or default project location
DEFAULT_SF_PATH = r"D:\CHATHURANGA\engines\stockfish\stockfish-windows-x86-64-avx2.exe"
STOCKFISH_PATH = os.environ.get("STOCKFISH_PATH", DEFAULT_SF_PATH)

# Engine defaults
DEFAULT_SKILL_LEVEL = 5  # 0 to 20
DEFAULT_MOVE_TIME_MS = 300  # ms
DEFAULT_MOVE_TIMEOUT_SECONDS = 15.0

# Recovery timeout for in-progress moves
IN_PROGRESS_TIMEOUT_SECONDS = 15.0
