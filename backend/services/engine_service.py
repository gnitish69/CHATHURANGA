"""
CHĀTURANGA Phase 3 — Engine Service
Manages Stockfish UCI engine lifecycle, async background search worker,
and deterministic fake engine support for testing.
"""

import os
import atexit
import threading
from concurrent.futures import ThreadPoolExecutor
import chess
import chess.engine
from backend.config import STOCKFISH_PATH, DEFAULT_SKILL_LEVEL, DEFAULT_MOVE_TIME_MS


class FakeEngine:
    """Deterministic scriptable mock engine for automated testing."""
    def __init__(self, script=None):
        self.script = script or {}  # fen or move_count -> uci move
        self.id = {"name": "FakeEngine Mock", "author": "CHĀTURANGA Tests"}
        self.call_count = 0

    def configure(self, options):
        pass

    def play(self, board, limit=None):
        self.call_count += 1
        fen = board.fen()
        # Script lookup by FEN or call count
        if fen in self.script:
            uci = self.script[fen]
            return chess.engine.PlayResult(chess.Move.from_uci(uci), None)
        if self.call_count in self.script:
            uci = self.script[self.call_count]
            return chess.engine.PlayResult(chess.Move.from_uci(uci), None)

        # Fallback: pick first legal move
        legal = list(board.legal_moves)
        if not legal:
            return chess.engine.PlayResult(None, None)
        return chess.engine.PlayResult(legal[0], None)

    def close(self):
        pass


class EngineService:
    def __init__(self, executable_path=None, use_fake=False):
        self.path = executable_path or STOCKFISH_PATH
        self.use_fake = use_fake
        self.engine = None
        self.engine_name = "Unknown"
        self.is_online = False
        self.lock = threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="StockfishWorker")
        self._init_engine()
        atexit.register(self.close)

    def _init_engine(self):
        if self.use_fake:
            self.engine = FakeEngine()
            self.engine_name = "FakeEngine (Test Mode)"
            self.is_online = True
            return

        # Check if executable exists
        if self.path and os.path.isfile(self.path):
            try:
                # Avoid starting multiple instances under Werkzeug reloader
                self.engine = chess.engine.SimpleEngine.popen_uci(self.path)
                self.engine_name = self.engine.id.get("name", "Stockfish")
                self.is_online = True
                print(f"[EngineService] Connected successfully to {self.engine_name} at {self.path}")
            except Exception as e:
                print(f"[EngineService] Failed to launch Stockfish at {self.path}: {e}")
                self.engine = None
                self.is_online = False
                self.engine_name = f"Error: {e}"
        else:
            print(f"[EngineService] Stockfish binary not found at '{self.path}'")
            self.engine = None
            self.is_online = False
            self.engine_name = "Not Installed"

    def get_status(self):
        """Return engine metadata and availability."""
        return {
            "status": "online" if self.is_online else "offline",
            "engine_name": self.engine_name,
            "path": self.path,
            "is_fake": self.use_fake
        }

    def play_sync(self, board, skill_level=DEFAULT_SKILL_LEVEL, move_time_ms=DEFAULT_MOVE_TIME_MS):
        """Synchronously request a move."""
        if not self.is_online or not self.engine:
            raise RuntimeError("Engine is offline or not available.")

        with self.lock:
            try:
                if not self.use_fake:
                    # Configure skill level (0 to 20)
                    clamped_skill = max(0, min(20, int(skill_level)))
                    self.engine.configure({"Skill Level": clamped_skill})

                time_sec = max(0.05, float(move_time_ms) / 1000.0)
                result = self.engine.play(board, chess.engine.Limit(time=time_sec))
                return result.move
            except Exception as e:
                print(f"[EngineService] Search failed: {e}")
                # Try to reinitialize
                self._init_engine()
                raise e

    def search_async(self, board_clone, skill_level, move_time_ms, on_complete, on_error=None):
        """
        Run engine search asynchronously in background worker.
        on_complete(move) will be called with the resulting chess.Move.
        """
        def _worker():
            try:
                move = self.play_sync(board_clone, skill_level, move_time_ms)
                if on_complete:
                    on_complete(move)
            except Exception as err:
                print(f"[EngineService Async] Error: {err}")
                if on_error:
                    on_error(err)

        self.executor.submit(_worker)

    def close(self):
        with self.lock:
            if self.engine:
                try:
                    self.engine.close()
                except Exception:
                    pass
                self.engine = None
                self.is_online = False
        try:
            self.executor.shutdown(wait=False)
        except Exception:
            pass
