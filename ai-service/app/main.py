from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import health, chat, diet, video, pose, memory, embeddings, orchestrator, agent, evaluator, food_vision
from app.core.config import settings
from app.core.llm import ollama
from app.vision import vision_adapter
import logging

logger = logging.getLogger("getfit-ai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: warm models into VRAM
    logger.info("Warming up models...")
    await ollama.warmup()
    # Warm the vision adapter (primary + fallback availability)
    try:
        await vision_adapter.warmup()
        logger.info("Vision adapter ready (primary=%s, fallback=%s)",
                    settings.VISION_PRIMARY, settings.VISION_FALLBACK)
    except Exception as e:
        logger.warning(f"Vision adapter warmup skipped: {e}")
    logger.info("Models warmed up — ready for low-latency inference")
    yield


app = FastAPI(
    title="GetFit AI Service",
    version="1.0.0",
    description="AI microservice for GetFit — chatbot, diet planning, video analysis, pose detection",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──
app.include_router(health.router, tags=["Health"])
app.include_router(chat.router, prefix="/chat", tags=["Chatbot"])
app.include_router(diet.router, prefix="/diet", tags=["Diet"])
app.include_router(video.router, prefix="/video", tags=["Video Analysis"])
app.include_router(pose.router, prefix="/pose", tags=["Pose Analysis"])
app.include_router(memory.router, prefix="/memory", tags=["Memory"])
app.include_router(embeddings.router, prefix="/embeddings", tags=["Embeddings"])
app.include_router(orchestrator.router, prefix="/orchestrate", tags=["Orchestrator"])
app.include_router(agent.router, prefix="/agent", tags=["Agent"])
app.include_router(evaluator.router, prefix="/evaluator", tags=["Evaluator"])
app.include_router(food_vision.router, tags=["Food Vision"])


@app.get("/")
async def root():
    return {
        "service": "GetFit AI",
        "version": "1.0.0",
        "docs": "/docs",
        "endpoints": {
            "health": "/health",
            "chat": "/chat/completions",
            "diet": "/diet/generate",
            "video_analyze": "/video/analyze",
            "video_result": "/video/result/{job_id}",
            "pose_analyze": "/pose/analyze",
            "memory_extract": "/memory/extract",
            "embed": "/embeddings/embed",
            "compile": "/embeddings/compile",
            "orchestrate_classify": "/orchestrate/classify",
            "orchestrate_reflect": "/orchestrate/reflect",
            "orchestrate_trajectory": "/orchestrate/trajectory",
            "agent_route_tools": "/agent/route-tools",
            "agent_reason": "/agent/reason",
            "agent_confidence": "/agent/confidence",
            "agent_predict": "/agent/predict",
            "evaluator_evaluate": "/evaluator/evaluate",
            "evaluator_simulate": "/evaluator/simulate",
            "evaluator_causal": "/evaluator/causal",
            "food_recognize": "/food-vision/recognize",
            "food_vision_health": "/food-vision/health",
        },
    }
