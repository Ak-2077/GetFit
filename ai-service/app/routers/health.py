from fastapi import APIRouter
from app.core.llm import ollama
from app.core.config import settings
from app.core.cache import cache_stats

router = APIRouter()


@router.get("/health")
async def health():
    llm_status = await ollama.health_check()
    return {
        "service": "getfit-ai",
        "status": "ok",
        "llm": llm_status,
        "config": {
            "model": settings.OLLAMA_MODEL,
            "ollama_url": settings.OLLAMA_BASE_URL,
            "keep_alive": settings.OLLAMA_KEEP_ALIVE,
        },
    }


@router.get("/diagnostics")
async def diagnostics():
    """Cache stats + model status + GPU config for observability dashboard."""
    llm_status = await ollama.health_check()
    cs = await cache_stats()
    return {
        "cache": cs,
        "models": llm_status.get("model_roles", {}),
        "loaded_models": llm_status.get("models", []),
        "status": llm_status.get("status", "unknown"),
        "gpu_config": {
            "keep_alive_seconds": settings.OLLAMA_KEEP_ALIVE,
            "main_model": settings.OLLAMA_MODEL,
            "fast_model": settings.OLLAMA_FAST_MODEL,
            "evaluator_model": settings.OLLAMA_EVALUATOR_MODEL,
            "compressor_model": settings.OLLAMA_COMPRESSOR_MODEL,
            "note": "Verify quantization: should be q4_K_M or q5_K_M for optimal VRAM/speed",
        },
    }
