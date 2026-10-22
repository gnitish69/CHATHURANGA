"""
Tests for EngineService (FakeEngine and real Stockfish).
"""

import os
import pytest
import chess
from backend.services.engine_service import EngineService, FakeEngine


def test_fake_engine_scripted():
    script = {1: "e2e4", 2: "e7e5"}
    fe = FakeEngine(script=script)
    board = chess.Board()

    res1 = fe.play(board)
    assert res1.move == chess.Move.from_uci("e2e4")

    board.push(res1.move)
    res2 = fe.play(board)
    assert res2.move == chess.Move.from_uci("e7e5")


def test_engine_service_with_fake():
    service = EngineService(use_fake=True)
    status = service.get_status()
    assert status["status"] == "online"
    assert status["is_fake"] is True

    board = chess.Board()
    move = service.play_sync(board, skill_level=5, move_time_ms=50)
    assert move is not None
    assert move in board.legal_moves

    service.close()


def test_real_stockfish_integration():
    """Runs against real Stockfish 18 if STOCKFISH_PATH is configured or default binary exists."""
    from backend.config import STOCKFISH_PATH
    sf_path = os.environ.get("STOCKFISH_PATH", STOCKFISH_PATH)
    if not sf_path or not os.path.isfile(sf_path):
        pytest.skip(f"STOCKFISH_PATH '{sf_path}' not found, skipping real binary test.")

    service = EngineService(executable_path=sf_path, use_fake=False)
    status = service.get_status()
    assert status["status"] == "online"
    assert "Stockfish" in status["engine_name"]

    board = chess.Board()
    move = service.play_sync(board, skill_level=5, move_time_ms=100)
    assert move is not None
    assert move in board.legal_moves

    service.close()
