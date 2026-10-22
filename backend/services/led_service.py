"""
CHĀTURANGA Phase 2 — LED Manager Service
Maintains state for the 64 board square LEDs.
"""

class LedService:
    def __init__(self):
        # square -> { color: "GREEN", mode: "SOLID" }
        self.active_leds = {}

    def set_leds(self, squares, clear_others=False):
        """
        Update LED configuration.
        squares: dict like { "e2": "YELLOW", "e4": { "color": "GREEN", "mode": "PULSE" } }
        """
        if clear_others:
            self.active_leds.clear()

        for sq, config in squares.items():
            sq = sq.lower()
            if not config:
                self.active_leds.pop(sq, None)
                continue

            if isinstance(config, str):
                color = config.upper()
                mode = "SOLID"
            elif isinstance(config, dict):
                color = config.get("color", "GREEN").upper()
                mode = config.get("mode", "SOLID").upper()
            else:
                color = "GREEN"
                mode = "SOLID"

            self.active_leds[sq] = {"color": color, "mode": mode}

        return self.get_state()

    def clear(self):
        self.active_leds.clear()
        return self.get_state()

    def get_state(self):
        return dict(self.active_leds)
