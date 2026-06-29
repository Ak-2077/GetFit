from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "qwen3:14b"
    OLLAMA_EMBED_MODEL: str = "nomic-embed-text"
    REDIS_URL: str = "redis://localhost:6379/0"
    API_PORT: int = 8100
    DEBUG: bool = True

    # ── Multi-Model Specialization ──
    # FAST: tiny model for routing, intent classification, topic detection (~1-2B params)
    OLLAMA_FAST_MODEL: str = "qwen3:1.7b"
    # MAIN: primary generation model (default OLLAMA_MODEL)
    # EVALUATOR: independent evaluation model
    OLLAMA_EVALUATOR_MODEL: str = "qwen3:8b"
    # COMPRESSOR: lightweight model for memory summarization/compression
    OLLAMA_COMPRESSOR_MODEL: str = "qwen3:1.7b"
    # VISION: model for food image recognition (must support vision capability)
    # Fast vision model (moondream ~1.7GB) for quick food identification
    OLLAMA_VISION_FAST_MODEL: str = "moondream"
    # Fallback/heavy vision model (qwen3.6 36B MoE) — slower but more detailed
    OLLAMA_VISION_MODEL: str = "qwen3.6"

    # ── Vision Adapter (modular vision backend) ──
    # Primary vision model for food analysis. Options: "qwen2.5-vl", "moondream", "gemini", "florence2"
    VISION_PRIMARY: str = "qwen2.5-vl"
    # Fallback vision model used if primary fails/times out/unavailable
    VISION_FALLBACK: str = "moondream"
    # Ollama model tag for Qwen2.5-VL (pull with: ollama pull qwen2.5vl:7b)
    OLLAMA_QWEN_VL_MODEL: str = "qwen2.5vl:7b"
    # Per-request vision timeout (seconds)
    VISION_TIMEOUT: float = 60.0
    # Fallback vision timeout (seconds) — shorter since it's the safety net
    VISION_FALLBACK_TIMEOUT: float = 30.0
    # Gemini Vision API key (future)
    GEMINI_API_KEY: str = ""
    # Nutrition estimation model — text-only, uses qwen3:8b for structured JSON
    OLLAMA_NUTRITION_MODEL: str = "qwen3:8b"
    # Keep-alive duration (seconds) — keeps models loaded in VRAM
    # 24h = models stay warm, avoids cold-start latency on first request
    OLLAMA_KEEP_ALIVE: int = 86400

    # Semantic cache TTL defaults (seconds)
    CACHE_TTL_SHORT: int = 1800     # 30min for casual/motivation
    CACHE_TTL_DEFAULT: int = 21600  # 6h for general
    CACHE_TTL_LONG: int = 86400     # 24h for factual/education

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
