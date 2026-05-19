from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import health, chat, diet, video, pose, memory, embeddings, orchestrator, agent, evaluator
from app.core.config import settings

app = FastAPI(
    title="GetFit AI Service",
    version="1.0.0",
    description="AI microservice for GetFit — chatbot, diet planning, video analysis, pose detection",
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
        },
    }
