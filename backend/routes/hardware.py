"""
CHĀTURANGA Phase 3 — Hardware Routes
Endpoints:
  POST /api/v1/hardware/scan
  POST /api/v1/hardware/leds
  GET  /api/v1/hardware/health
  GET  /api/v1/hardware/engine_status
"""

import time
import chess
from flask import Blueprint, request, jsonify, current_app

hardware_bp = Blueprint("hardware", __name__, url_prefix="/api/v1/hardware")

_START_TIME = time.time()


@hardware_bp.route("/scan", methods=["POST"])
def hardware_scan():
    """
    Receives debounced sensor scan payload:
    {
      "timestamp": 1729601400000,
      "bitmap_hex": "0xFFFF00000000FFFF",
      "diff": { "lifted": ["e2"], "placed": ["e4"] },
      "debounced": true,
      "seq": 10
    }
    """
    payload = request.get_json(silent=True) or {}
    game_session = current_app.game_session
    led_service = current_app.led_service

    result = game_session.process_scan(payload)

    # Sync LED service if leds were generated
    if "leds" in result and isinstance(result["leds"], dict):
        clear_others = (result.get("status") in ("accepted", "recovery"))
        led_service.set_leds(result["leds"], clear_others=clear_others)

    # Status codes:
    # accepted / intermediate / idle / warning / game_over -> 200
    # rejected / recovery -> 400
    status_code = 400 if result.get("status") in ("rejected", "recovery") else 200
    return jsonify(result), status_code


@hardware_bp.route("/leds", methods=["POST"])
def set_leds():
    """
    Command board LEDs directly:
    {
      "clearOthers": true,
      "squares": { "e2": "YELLOW", "e4": "GREEN" }
    }
    """
    payload = request.get_json(silent=True) or {}
    squares = payload.get("squares", {})
    clear_others = payload.get("clearOthers", False)
    led_service = current_app.led_service

    active = led_service.set_leds(squares, clear_others=clear_others)
    return jsonify({
        "status": "success",
        "active_led_count": len(active),
        "leds": active
    }), 200


@hardware_bp.route("/engine_status", methods=["GET"])
def engine_status():
    """Check Stockfish engine process status."""
    engine_service = current_app.engine_service
    status = engine_service.get_status() if engine_service else {"status": "offline"}
    return jsonify(status), 200


@hardware_bp.route("/health", methods=["GET"])
def health():
    """Returns backend, engine, and hardware layer health info."""
    uptime = int(time.time() - _START_TIME)
    engine_service = current_app.engine_service
    eng_status = engine_service.get_status() if engine_service else {"status": "offline"}

    return jsonify({
        "status": "healthy",
        "uptime_seconds": uptime,
        "backend_version": "1.0.0-phase3",
        "python_chess_version": getattr(chess, "__version__", "1.11.2"),
        "engine": eng_status
    }), 200
