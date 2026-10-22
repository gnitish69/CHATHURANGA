"""
Tests for full game rules: checkmate, resign, draw claim, and PGN generation.
"""

import pytest
import chess
from backend.services.engine_service import EngineService
from backend.services.game_session import GameSession, STARTING_OCCUPANCY


@pytest.fixture
def session():
    eng = EngineService(use_fake=True)
    gs = GameSession(eng, mode="two_player")
    gs.process_scan({"bitmap_hex": hex(STARTING_OCCUPANCY)})
    yield gs
    eng.close()


def test_scholars_mate_and_game_over(session):
    moves = ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"]
    for mv_str in moves:
        mv = chess.Move.from_uci(mv_str)
        res = session._apply_accepted_move(mv)

    assert res["is_game_over"] is True
    assert res["is_check"] is True
    assert session.phase == "GAME_OVER"
    assert "Checkmate" in res["game_over"]["reason"]
    assert res["game_over"]["result"] == "1-0"


def test_resignation(session):
    res = session.resign("white")
    assert res["status"] == "game_over"
    assert res["result"] == "0-1"
    assert session.phase == "GAME_OVER"


def test_pgn_export(session):
    session._apply_accepted_move(chess.Move.from_uci("e2e4"))
    session._apply_accepted_move(chess.Move.from_uci("e7e5"))
    pgn = session.get_pgn()
    assert "1. e4 e5" in pgn
    assert "CHĀTURANGA" in pgn


def test_idempotent_seq(session):
    # Send scan with seq 42
    payload = {
        "seq": 42,
        "bitmap_hex": hex(STARTING_OCCUPANCY),
        "diff": {"lifted": ["e2"], "placed": []}
    }
    res1 = session.process_scan(payload)
    # Send exact same seq 42
    res2 = session.process_scan(payload)
    assert res1 == res2
