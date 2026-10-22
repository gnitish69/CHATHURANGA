"""
Tests for engine move guidance and step-by-step physical LED feedback.
"""

import pytest
import chess
from backend.services.engine_service import EngineService, FakeEngine
from backend.services.game_session import GameSession, STARTING_OCCUPANCY


def test_normal_engine_move_guidance():
    # Fake engine that responds with e7e5 to e2e4
    fe = FakeEngine({1: "e7e5"})
    eng = EngineService(use_fake=True)
    eng.engine = fe

    session = GameSession(eng, mode="vs_engine", human_color="white")
    # Setup verify
    session.process_scan({"bitmap_hex": hex(STARTING_OCCUPANCY)})

    # Human plays e2-e4
    e2e4_occ = (STARTING_OCCUPANCY ^ (1 << chess.E2)) | (1 << chess.E4)
    res_move = session.process_scan({"bitmap_hex": hex(e2e4_occ)})
    assert res_move["status"] == "accepted"

    # Engine executes in background worker
    import time
    time.sleep(0.1)

    assert session.phase == "GUIDING_ENGINE_MOVE"
    assert len(session.guidance_steps) == 1
    step1 = session.guidance_steps[0]
    assert step1["leds"]["e7"] == "YELLOW"
    assert step1["leds"]["e5"] == "GREEN"

    # Human physically moves engine's piece from e7 to e5
    e7e5_occ = (e2e4_occ ^ (1 << chess.E7)) | (1 << chess.E5)
    res_guided = session.process_scan({"bitmap_hex": hex(e7e5_occ)})

    assert res_guided["status"] == "accepted"
    assert res_guided["phase"] == "WAITING_MOVE"
    assert res_guided["move_uci"] == "e7e5"
    assert session.board.turn == chess.WHITE

    eng.close()


def test_capture_guidance_two_steps():
    # Setup position where Black Knight captures White pawn on d4 (Nxd4)
    eng = EngineService(use_fake=True)
    session = GameSession(eng, mode="vs_engine", human_color="white")
    session.board = chess.Board("r1bqkbnr/pppp1ppp/2n5/4p3/3P4/5N2/PPP1PPPP/RNBQKB1R b KQkq - 1 3")

    # Manually generate guidance for move c6xd4
    move = chess.Move.from_uci("c6d4")
    session._generate_engine_guidance(move)

    assert len(session.guidance_steps) == 2

    # Step 1: Remove captured pawn on d4
    step1 = session.guidance_steps[0]
    assert step1["leds"]["d4"]["color"] == "MAGENTA"
    assert "Remove captured piece" in step1["instruction"]

    # Step 2: Move Knight c6 to d4
    step2 = session.guidance_steps[1]
    assert step2["leds"]["c6"] == "YELLOW"
    assert step2["leds"]["d4"] == "GREEN"

    eng.close()
