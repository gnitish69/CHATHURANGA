"""
CHĀTURANGA Phase 3 — Game Routes
Endpoints:
  GET  /api/v1/game/state
  POST /api/v1/game/new
  POST /api/v1/game/promotion
  POST /api/v1/game/resign
  POST /api/v1/game/claim_draw
  GET  /api/v1/game/pgn
  POST /api/v1/game/reset
  POST /api/v1/game/move (debug only)
"""

from flask import Blueprint, request, jsonify, current_app, Response

game_bp = Blueprint("game", __name__, url_prefix="/api/v1/game")


@game_bp.route("/state", methods=["GET"])
def get_game_state():
    """Returns authoritative game state, turn, FEN, phase, guidance, and recovery."""
    game_session = current_app.game_session
    state = game_session.get_state()
    return jsonify(state), 200


@game_bp.route("/new", methods=["POST"])
def new_game():
    """
    Start new game session:
    {
      "mode": "vs_engine" | "two_player",
      "human_color": "white" | "black",
      "skill_level": 5,
      "move_time_ms": 300
    }
    """
    payload = request.get_json(silent=True) or {}
    mode = payload.get("mode", "two_player")
    human_color = payload.get("human_color", "white")
    skill_level = payload.get("skill_level", 5)
    move_time_ms = payload.get("move_time_ms", 300)

    game_session = current_app.game_session
    led_service = current_app.led_service
    led_service.clear()

    state = game_session.start_new_game(
        mode=mode,
        human_color=human_color,
        skill_level=skill_level,
        move_time_ms=move_time_ms
    )
    return jsonify({
        "status": "created",
        "game": state,
        **state
    }), 200


@game_bp.route("/promotion", methods=["POST"])
def choose_promotion():
    """
    Choose promotion piece:
    { "piece": "q" | "r" | "b" | "n" }
    """
    payload = request.get_json(silent=True) or {}
    piece = payload.get("piece", "q")
    game_session = current_app.game_session
    led_service = current_app.led_service

    result = game_session.choose_promotion(piece)
    if result.get("status") == "accepted":
        if "leds" in result:
            led_service.set_leds(result["leds"], clear_others=True)
        return jsonify(result), 200
    else:
        return jsonify(result), 400


@game_bp.route("/resign", methods=["POST"])
def resign():
    """
    Resign active game:
    { "color": "white" | "black" }
    """
    payload = request.get_json(silent=True) or {}
    color = payload.get("color", "white")
    game_session = current_app.game_session
    result = game_session.resign(color)
    return jsonify(result), 200


@game_bp.route("/claim_draw", methods=["POST"])
def claim_draw():
    """Claim draw if threefold repetition or 50-move rule is satisfied."""
    game_session = current_app.game_session
    result = game_session.claim_draw()
    code = 200 if result.get("status") == "game_over" else 400
    return jsonify(result), code


@game_bp.route("/pgn", methods=["GET"])
def get_pgn():
    """Return game history formatted as standard PGN."""
    game_session = current_app.game_session
    pgn_text = game_session.get_pgn()
    if request.headers.get("Accept") == "application/json" or request.args.get("format") == "json":
        return jsonify({"pgn": pgn_text, "status": "ok"}), 200
    return Response(pgn_text, mimetype="text/plain")


@game_bp.route("/reset", methods=["POST"])
def reset_game():
    """Resets the chess game session."""
    game_session = current_app.game_session
    led_service = current_app.led_service

    state = game_session.start_new_game()
    led_service.clear()

    return jsonify({
        "status": "reset",
        "fen": state["fen"],
        "turn": state["turn"],
        "phase": state["phase"],
        "message": "Game reset to setup verification."
    }), 200


@game_bp.route("/move", methods=["POST"])
def debug_execute_move():
    """Debug only: execute move directly via UCI."""
    payload = request.get_json(silent=True) or {}
    move_str = payload.get("move", "").strip()

    if len(move_str) < 4:
        return jsonify({"status": "rejected", "reason": "Invalid UCI notation."}), 400

    import chess
    try:
        from_sq = chess.parse_square(move_str[:2])
        to_sq = chess.parse_square(move_str[2:4])
        promo = move_str[4] if len(move_str) >= 5 else None
        promo_piece = getattr(chess, promo.upper(), None) if promo else None
        mv = chess.Move(from_sq, to_sq, promotion=promo_piece)
    except ValueError:
        return jsonify({"status": "rejected", "reason": "Bad coordinates."}), 400

    game_session = current_app.game_session
    if mv in game_session.board.legal_moves:
        result = game_session._apply_accepted_move(mv)
        return jsonify(result), 200
    else:
        return jsonify({"status": "rejected", "reason": "Illegal move."}), 400
