"""
Integration tests for /api/v1/game/* endpoints.
"""

import pytest
import chess
from backend.app import create_app


@pytest.fixture
def client():
    app = create_app({"TESTING": True})
    with app.test_client() as client:
        yield client


def test_get_game_state(client):
    res = client.get("/api/v1/game/state")
    assert res.status_code == 200
    data = res.get_json()
    assert data["fen"] == chess.STARTING_FEN
    assert data["turn"] == "white"
    assert data["is_check"] is False
    assert data["is_game_over"] is False
    assert data["move_count"] == 0


def test_execute_move_direct(client):
    res = client.post("/api/v1/game/move", json={"move": "e2e4"})
    assert res.status_code == 200
    data = res.get_json()
    assert data["status"] == "accepted"
    assert data["move_uci"] == "e2e4"
    assert data["turn"] == "black"

    # Verify game state reflects the move
    state_res = client.get("/api/v1/game/state")
    state = state_res.get_json()
    assert state["move_count"] == 1
    assert state["turn"] == "black"


def test_execute_invalid_move_direct(client):
    # Invalid UCI syntax
    res_bad = client.post("/api/v1/game/move", json={"move": "x"})
    assert res_bad.status_code == 400

    # Illegal chess move
    res_illegal = client.post("/api/v1/game/move", json={"move": "e2e5"})
    assert res_illegal.status_code == 400
    data = res_illegal.get_json()
    assert data["status"] == "rejected"


def test_game_reset(client):
    # Make a move first
    client.post("/api/v1/game/move", json={"move": "e2e4"})

    # Reset
    res = client.post("/api/v1/game/reset")
    assert res.status_code == 200
    data = res.get_json()
    assert data["status"] == "reset"
    assert data["fen"] == chess.STARTING_FEN
    assert data["turn"] == "white"

    # Verify state is clean
    state_res = client.get("/api/v1/game/state")
    state = state_res.get_json()
    assert state["move_count"] == 0
