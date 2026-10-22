"""
Integration tests for /api/v1/hardware/* endpoints.
"""

import pytest
from backend.app import create_app


@pytest.fixture
def client():
    app = create_app({"TESTING": True})
    with app.test_client() as client:
        yield client


def test_health_endpoint(client):
    res = client.get("/api/v1/hardware/health")
    assert res.status_code == 200
    data = res.get_json()
    assert data["status"] == "healthy"
    assert "uptime_seconds" in data
    assert "python_chess_version" in data


def test_scan_lift_intermediate(client):
    payload = {
        "timestamp": 1729600000000,
        "bitmap_hex": "0xFFFF00000000FFFF",
        "diff": {
            "lifted": ["e2"],
            "placed": []
        },
        "debounced": True
    }
    res = client.post("/api/v1/hardware/scan", json=payload)
    assert res.status_code == 200
    data = res.get_json()
    assert data["status"] == "intermediate"
    assert data["lifted"] == "e2"
    assert "e3" in data["legalDestinations"]
    assert "e4" in data["legalDestinations"]


def test_scan_move_accepted(client):
    payload = {
        "timestamp": 1729600001000,
        "bitmap_hex": "0xFFFF00000000FFFF",
        "diff": {
            "lifted": ["e2"],
            "placed": ["e4"]
        },
        "debounced": True
    }
    res = client.post("/api/v1/hardware/scan", json=payload)
    assert res.status_code == 200
    data = res.get_json()
    assert data["status"] == "accepted"
    assert data["move_uci"] == "e2e4"
    assert data["turn"] == "black"
    assert "4P3" in data["fen"]


def test_scan_illegal_move_rejected(client):
    # Try illegal pawn move e2 to e5
    payload = {
        "timestamp": 1729600002000,
        "bitmap_hex": "0xFFFF00000000FFFF",
        "diff": {
            "lifted": ["e2"],
            "placed": ["e5"]
        },
        "debounced": True
    }
    res = client.post("/api/v1/hardware/scan", json=payload)
    assert res.status_code == 400
    data = res.get_json()
    assert data["status"] == "rejected"
    assert "reason" in data
    assert "e2" in data["offending_squares"]
    assert data["leds"]["e2"] == "RED"


def test_command_leds(client):
    payload = {
        "clearOthers": True,
        "squares": {
            "e2": "YELLOW",
            "e4": {"color": "GREEN", "mode": "PULSE"}
        }
    }
    res = client.post("/api/v1/hardware/leds", json=payload)
    assert res.status_code == 200
    data = res.get_json()
    assert data["status"] == "success"
    assert data["active_led_count"] == 2
    assert data["leds"]["e2"]["color"] == "YELLOW"
    assert data["leds"]["e4"]["color"] == "GREEN"
