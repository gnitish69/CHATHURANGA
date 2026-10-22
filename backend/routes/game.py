"""
CHĀTURANGA Phase 2 — Game Routes
Endpoints:
  GET  /api/v1/game/state
  POST /api/v1/game/move
  POST /api/v1/game/reset
"""

from flask import Blueprint, request, jsonify, current_app

game_bp = Blueprint("game", __name__, url_prefix="/api/v1/game")


@game_bp.route("/state", methods=["GET"])
def get_game_state():
    """Returns authoritative game state, turn, FEN, and move history."""
    chess_service = current_app.chess_service
    state = chess_service.get_state()
    return jsonify(state), 200


@game_bp.route("/move", methods=["POST"])
def execute_move():
    """
    Directly execute a move via UCI notation:
    {
      "move": "e2e4",
      "promotion": "q"
    }
    """
    payload = request.get_json(silent=True) or {}
    move_str = payload.get("move", "").strip()
    promotion = payload.get("promotion", "q")

    if len(move_str) < 4:
        return jsonify({
            "status": "rejected",
            "reason": f"Invalid move notation '{move_str}'. Expected UCI (e.g. 'e2e4')."
        }), 400

    from_sq = move_str[:2]
    to_sq = move_str[2:4]
    if len(move_str) >= 5:
        promotion = move_str[4]

    chess_service = current_app.chess_service
    led_service = current_app.led_service

    result = chess_service.execute_move(from_sq, to_sq, promotion=promotion)

    if result.get("status") == "accepted":
        if "leds" in result:
            led_service.set_leds(result["leds"], clear_others=True)
        return jsonify(result), 200
    else:
        return jsonify(result), 400


@game_bp.route("/reset", methods=["POST"])
def reset_game():
    """Resets the chess game to the standard starting position."""
    chess_service = current_app.chess_service
    led_service = current_app.led_service

    state = chess_service.reset()
    led_service.clear()

    return jsonify({
        "status": "reset",
        "fen": state["fen"],
        "turn": state["turn"],
        "message": "Game reset to starting position."
    }), 200
