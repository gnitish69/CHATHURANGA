"""
Tests for GameSession state machine:
- SETUP_VERIFY
- WAITING_MOVE
- MOVE_IN_PROGRESS
- RECOVERY
- AWAITING_PROMOTION_CHOICE
"""

import pytest
import chess
from backend.services.engine_service import EngineService
from backend.services.game_session import GameSession, STARTING_OCCUPANCY


@pytest.fixture
def session():
    eng = EngineService(use_fake=True)
    gs = GameSession(eng, mode="two_player")
    yield gs
    eng.close()


def test_setup_verify_mismatch_and_success(session):
    # 1. Starting session is in SETUP_VERIFY
    assert session.phase == "SETUP_VERIFY"

    # Incomplete board (empty board bitmap 0x0)
    res_bad = session.process_scan({"bitmap_hex": "0x0"})
    assert res_bad["status"] == "warning"
    assert res_bad["phase"] == "SETUP_VERIFY"
    assert "recovery" in res_bad
    assert len(res_bad["recovery"]["missing_squares"]) == 32

    # Provide correct starting position bitmap
    start_hex = hex(STARTING_OCCUPANCY)
    res_ok = session.process_scan({"bitmap_hex": start_hex})
    assert res_ok["status"] == "accepted"
    assert res_ok["phase"] == "WAITING_MOVE"
    assert session.phase == "WAITING_MOVE"


def test_move_progression_and_cancellation(session):
    start_hex = hex(STARTING_OCCUPANCY)
    session.process_scan({"bitmap_hex": start_hex})
    assert session.phase == "WAITING_MOVE"

    # Lift e2 pawn (bit 12 turns 0)
    e2_lifted_occ = STARTING_OCCUPANCY ^ (1 << chess.E2)
    res_lift = session.process_scan({
        "bitmap_hex": hex(e2_lifted_occ),
        "diff": {"lifted": ["e2"], "placed": []}
    })
    assert res_lift["status"] == "intermediate"
    assert res_lift["phase"] == "MOVE_IN_PROGRESS"

    # Put e2 back onto e2 (cancels move)
    res_cancel = session.process_scan({
        "bitmap_hex": start_hex,
        "diff": {"lifted": [], "placed": ["e2"]}
    })
    assert res_cancel["status"] == "idle"
    assert res_cancel["phase"] == "WAITING_MOVE"


def test_illegal_move_and_recovery(session):
    start_hex = hex(STARTING_OCCUPANCY)
    session.process_scan({"bitmap_hex": start_hex})

    # Illegal jump e2 to e5 (pawn jumps 3 squares)
    illegal_occ = (STARTING_OCCUPANCY ^ (1 << chess.E2)) | (1 << chess.E5)
    res_illegal = session.process_scan({
        "bitmap_hex": hex(illegal_occ),
        "diff": {"lifted": ["e2"], "placed": ["e5"]}
    })
    assert res_illegal["status"] == "recovery"
    assert res_illegal["phase"] == "RECOVERY"
    assert "e2" in res_illegal["recovery"]["missing_squares"]
    assert "e5" in res_illegal["recovery"]["extra_squares"]
    assert res_illegal["leds"]["e2"]["color"] == "BLUE"
    assert res_illegal["leds"]["e5"]["color"] == "RED"

    # FEN must remain unchanged!
    assert session.board.fen() == chess.STARTING_FEN

    # Restore board back to starting occupancy
    res_restored = session.process_scan({"bitmap_hex": start_hex})
    assert res_restored["status"] == "idle"
    assert res_restored["phase"] == "WAITING_MOVE"


def test_promotion_choice(session):
    # Setup position where pawn is about to promote
    session.process_scan({"bitmap_hex": hex(STARTING_OCCUPANCY)})
    session.board = chess.Board("8/4P3/8/8/8/8/8/4K2k w - - 0 1")
    occ_before = int(session.board.occupied)

    # Move pawn e7 to e8
    occ_after = (occ_before ^ (1 << chess.E7)) | (1 << chess.E8)
    res_promo = session.process_scan({"bitmap_hex": hex(occ_after)})
    assert res_promo["status"] == "intermediate"
    assert res_promo["phase"] == "AWAITING_PROMOTION_CHOICE"

    # Choose Knight promotion
    res_choice = session.choose_promotion("n")
    assert res_choice["status"] == "accepted"
    assert res_choice["move_uci"] == "e7e8n"
    promoted = session.board.piece_at(chess.E8)
    assert promoted.piece_type == chess.KNIGHT
