"""
Unit tests for ChessEngineService (python-chess authoritative rules).
"""

import pytest
import chess
from backend.services.chess_engine import ChessEngineService


@pytest.fixture
def engine():
    return ChessEngineService()


def test_initial_state(engine):
    state = engine.get_state()
    assert state["fen"] == chess.STARTING_FEN
    assert state["turn"] == "white"
    assert state["is_check"] is False
    assert state["is_game_over"] is False
    assert state["move_count"] == 0


def test_legal_moves_progression(engine):
    # 1. White plays e4
    res1 = engine.execute_move("e2", "e4")
    assert res1["status"] == "accepted"
    assert res1["move_uci"] == "e2e4"
    assert res1["move_san"] == "e4"
    assert res1["turn"] == "black"
    assert res1["is_check"] is False

    # 2. Black plays e5
    res2 = engine.execute_move("e7", "e5")
    assert res2["status"] == "accepted"
    assert res2["move_uci"] == "e7e5"
    assert res2["turn"] == "white"

    # 3. White plays Nf3
    res3 = engine.execute_move("g1", "f3")
    assert res3["status"] == "accepted"
    assert res3["move_san"] == "Nf3"
    assert res3["turn"] == "black"


def test_illegal_moves_rejected(engine):
    # Black attempts to move first
    res_turn = engine.execute_move("e7", "e5")
    assert res_turn["status"] == "rejected"

    # White attempts illegal pawn jump
    res_illegal = engine.execute_move("e2", "e5")
    assert res_illegal["status"] == "rejected"
    assert "e2" in res_illegal["offending_squares"]
    assert res_illegal["leds"]["e2"] == "RED"

    # FEN must remain unchanged after rejections
    assert engine.get_state()["fen"] == chess.STARTING_FEN


def test_lift_intermediate_scan(engine):
    # Pick up e2 pawn
    scan_res = engine.process_scan({
        "diff": {"lifted": ["e2"], "placed": []}
    })
    assert scan_res["status"] == "intermediate"
    assert scan_res["lifted"] == "e2"
    assert set(scan_res["legalDestinations"]) == {"e3", "e4"}
    assert scan_res["leds"]["e2"] == "YELLOW"
    assert scan_res["leds"]["e3"] == "CYAN"
    assert scan_res["leds"]["e4"] == "CYAN"


def test_move_cancellation(engine):
    # Pick up e2
    engine.process_scan({"diff": {"lifted": ["e2"], "placed": []}})
    # Put it back on e2
    cancel_res = engine.process_scan({"diff": {"lifted": [], "placed": ["e2"]}})
    assert cancel_res["status"] == "idle"
    assert engine.active_lift is None


def test_castling_resolution(engine):
    # Clear kingside pieces to test castling
    engine.board = chess.Board("rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4")
    res = engine.execute_move("e1", "g1")
    assert res["status"] == "accepted"
    assert res["move_san"] == "O-O"
    # Check that Rook was moved to f1 and LEDs illuminate both King and Rook
    assert "e1" in res["leds"]
    assert "g1" in res["leds"]
    assert res["leds"]["h1"] == "YELLOW"
    assert res["leds"]["f1"] == "GREEN"


def test_en_passant_resolution(engine):
    # Setup board for en passant
    engine.board = chess.Board("rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3")
    res = engine.execute_move("e5", "f6")
    assert res["status"] == "accepted"
    assert "f6" in res["move_san"]
    # Black pawn on f5 must be captured
    assert engine.board.piece_at(chess.F5) is None


def test_pawn_promotion(engine):
    # White pawn on 7th rank ready to promote
    engine.board = chess.Board("8/4P3/8/8/8/8/8/4K2k w - - 0 1")
    res = engine.execute_move("e7", "e8", promotion="q")
    assert res["status"] == "accepted"
    assert res["move_uci"] == "e7e8q"
    promoted_piece = engine.board.piece_at(chess.E8)
    assert promoted_piece.piece_type == chess.QUEEN


def test_check_and_checkmate(engine):
    # Scholar's mate
    engine.execute_move("e2", "e4")
    engine.execute_move("e7", "e5")
    engine.execute_move("d1", "h5")
    engine.execute_move("b8", "c6")
    engine.execute_move("f1", "c4")
    engine.execute_move("g8", "f6")
    mate_res = engine.execute_move("h5", "f7")

    assert mate_res["status"] == "accepted"
    assert mate_res["is_check"] is True
    assert mate_res["is_game_over"] is True
    assert mate_res["move_san"] == "Qxf7#"
    assert "MATE" in mate_res["oled_message"]
    # Black King square (e8) should be highlighted in RED
    assert mate_res["leds"]["e8"] == "RED"
