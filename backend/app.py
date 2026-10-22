"""
CHĀTURANGA Phase 3 — Flask Application Factory
Integrates GameSession, EngineService (Stockfish), and LED manager.
"""

from flask import Flask
from flask_cors import CORS
from backend.services.engine_service import EngineService
from backend.services.game_session import GameSession
from backend.services.chess_engine import ChessEngineService
from backend.services.led_service import LedService
from backend.routes.hardware import hardware_bp
from backend.routes.game import game_bp


def create_app(test_config=None):
    app = Flask(__name__)

    # Enable CORS for local simulator access from any origin/port
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    app.config.from_mapping(
        SECRET_KEY="chaturanga_dev_key",
        TESTING=False,
    )

    if test_config:
        app.config.from_mapping(test_config)

    # 1. Initialize Engine Service (FakeEngine if testing or real Stockfish)
    use_fake_engine = bool(test_config and test_config.get("USE_FAKE_ENGINE"))
    engine_path = test_config.get("STOCKFISH_PATH") if test_config else None
    app.engine_service = EngineService(executable_path=engine_path, use_fake=use_fake_engine)

    # 2. Initialize Game Session (State Machine)
    app.game_session = GameSession(app.engine_service)

    # 3. Legacy services for backward compatibility
    app.chess_service = ChessEngineService()
    app.led_service = LedService()

    # Register API Blueprints
    app.register_blueprint(hardware_bp)
    app.register_blueprint(game_bp)

    @app.route("/", methods=["GET"])
    def root():
        return {
            "project": "CHĀTURANGA",
            "phase": "Phase 3 — Playable Physical Chess & Stockfish",
            "status": "online",
            "api_prefix": "/api/v1",
            "engine": app.engine_service.get_status()
        }, 200

    return app
