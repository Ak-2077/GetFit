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
    # VISION: model for food image recognition (pull with: ollama pull moondream)
    OLLAMA_VISION_MODEL: str = "moondream"
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
