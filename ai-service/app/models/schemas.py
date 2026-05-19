from pydantic import BaseModel
from typing import Optional


# ── Chat ──

class Message(BaseModel):
    role: str          # "user" | "assistant" | "system"
    content: str


class ChatRequest(BaseModel):
    messages: list[Message]
    user_context: Optional[dict] = None   # user profile data for personalization
    user_memories: list[str] = []         # stored facts from past conversations (raw fallback)
    compiled_memories: str = ""           # optimized compiled memory context
    response_mode: str = "coach"          # coach|technical|supportive|concise|planner|corrective
    intent: str = "coaching"              # classified intent
    token_budget: int = 300               # max response tokens
    trajectory_context: str = ""          # goal trajectory insights


class ChatResponse(BaseModel):
    content: str
    role: str = "assistant"


# ── Diet ──

class DietRequest(BaseModel):
    goal: str = "maintain"                # "lose" | "gain" | "maintain"
    weight: Optional[float] = None
    target_weight: Optional[float] = None
    height: Optional[float] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    activity_level: Optional[str] = None
    diet_preference: str = "non-veg"
    calorie_target: Optional[int] = None
    allergies: list[str] = []


class DietResponse(BaseModel):
    plan: dict
    total_calories: int
    source: str = "llm"


# ── Video Analysis ──

class VideoAnalysisRequest(BaseModel):
    video_url: str
    exercise_type: Optional[str] = None


class VideoAnalysisResponse(BaseModel):
    job_id: str
    status: str = "queued"


class VideoResultResponse(BaseModel):
    job_id: str
    status: str
    exercise_detected: Optional[str] = None
    total_reps: Optional[int] = None
    form_score: Optional[float] = None
    feedback: Optional[dict] = None


# ── Pose Analysis ──

class PoseAnalysisRequest(BaseModel):
    keypoints: list[list[float]]          # [[x, y, confidence], ...] × 17
    exercise_type: Optional[str] = None


class PoseAnalysisResponse(BaseModel):
    form_score: float
    issues: list[str]
    corrections: list[str]
    joint_angles: Optional[dict] = None
