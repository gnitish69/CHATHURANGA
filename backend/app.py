"""
CHĀTURANGA Phase 2 — Flask Application Factory
"""

from flask import Flask
from flask_cors import CORS
from backend.services.chess_engine import ChessEngineService
from backend.services.led_service import LedService
from backend.routes.hardware import hardware_bp
from backend.routes.game import game_bp


def create_app(test_config=None):
    app = Flask(__name__)

    # Enable CORS for local simulator access from any origin/port
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # Default configuration
    app.config.from_mapping(
        SECRET_KEY="chaturanga_dev_key",
        TESTING=False,
    )

    if test_config:
        app.config.from_mapping(test_config)

    # Initialize shared services
    app.chess_service = ChessEngineService()
    app.led_service = LedService()

    # Register API Blueprints
    app.register_blueprint(hardware_bp)
    app.register_blueprint(game_bp)

    @app.route("/", methods=["GET"])
    def root():
        return {
            "project": "CHĀTURANGA",
            "phase": "Phase 2 — Flask Backend",
            "status": "online",
            "api_prefix": "/api/v1"
        }, 200

    return app
