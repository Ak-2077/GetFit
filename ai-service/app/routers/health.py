from fastapi import APIRouter
from app.core.llm import ollama
from app.core.config import settings

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
        },
    }
