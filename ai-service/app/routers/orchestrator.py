from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from app.core.llm import ollama
import json

router = APIRouter()

# ═══════════════════════════════════════════════════════════════
# INTENT ROUTER + TASK PLANNER
# Single fast LLM call that classifies intent, picks mode,
# determines knowledge sources, and sets token budget.
# ═══════════════════════════════════════════════════════════════

CLASSIFY_PROMPT = """/no_think
You are an intent classification system for a fitness AI coach. Analyze the user message and output a JSON plan.

INTENTS (pick exactly one):
- workout_planning: creating/modifying workout routines, exercises, splits
- nutrition_question: diet, calories, macros, meal plans, supplements
- form_correction: exercise form, technique, injury prevention
- factual_query: specific fitness facts, science, definitions
- progress_analysis: reviewing progress, trends, plateaus, PRs
- emotional_support: frustration, demotivation, burnout, anxiety
- motivation: need encouragement, accountability, pump-up
- coaching: personalized advice combining multiple areas
- correction_request: user correcting AI or providing updated info
- memory_recall: user asking what AI remembers about them
- casual_chat: greeting, small talk, off-topic
- injury_concern: pain, injury, recovery, medical adjacent

RESPONSE MODES:
- coach: warm, personalized, action-oriented (default for coaching/planning)
- technical: precise, evidence-based, detailed (for factual/form/nutrition science)
- supportive: empathetic, encouraging, gentle (for emotional/motivation)
- concise: brief direct answer (for simple facts, casual)
- planner: structured output with sets/reps/meals (for workout/nutrition plans)
- corrective: acknowledge mistake, update understanding (for corrections)

KNOWLEDGE SOURCES (pick all that apply):
- user_memory: user's stored facts, preferences, injuries
- exercise_db: exercise database for movements, muscles
- nutrition_db: food database for calories, macros
- session_history: recent conversation context
- episodic_memory: past behavioral patterns, trends
- none: no external knowledge needed

DEPTH (1-3):
- 1: quick answer (1-3 sentences)
- 2: moderate answer (1-2 paragraphs)
- 3: detailed answer (structured, comprehensive)

TOKEN BUDGET:
- 150: quick responses
- 300: moderate responses
- 500: detailed plans/explanations

RESPOND WITH ONLY JSON (no markdown):
{"intent": "...", "mode": "...", "knowledge_sources": ["..."], "depth": 2, "token_budget": 300, "needs_reflection": false, "reasoning": "brief reason"}

Set needs_reflection=true ONLY for: workout plans, nutrition plans, injury concerns, correction requests.
For casual chat and simple facts, needs_reflection=false."""


class ClassifyRequest(BaseModel):
    message: str
    recent_context: List[str] = []  # last 2-3 messages for context


class ClassifyResponse(BaseModel):
    intent: str
    mode: str
    knowledge_sources: List[str]
    depth: int
    token_budget: int
    needs_reflection: bool
    reasoning: str


@router.post("/classify", response_model=ClassifyResponse)
async def classify_intent(request: ClassifyRequest):
    """Classify user intent and create a task plan in a single fast LLM call."""
    try:
        context = ""
        if request.recent_context:
            context = "\n\nRecent context:\n" + "\n".join(request.recent_context[-3:])

        response = await ollama.generate_json(
            prompt=f"Classify this user message:{context}\n\nMessage: \"{request.message}\"",
            system=CLASSIFY_PROMPT,
            model="fast",
        )

        plan = json.loads(response)

        # Validate and sanitize
        valid_intents = [
            "workout_planning", "nutrition_question", "form_correction",
            "factual_query", "progress_analysis", "emotional_support",
            "motivation", "coaching", "correction_request", "memory_recall",
            "casual_chat", "injury_concern",
        ]
        valid_modes = ["coach", "technical", "supportive", "concise", "planner", "corrective"]

        intent = plan.get("intent", "coaching")
        if intent not in valid_intents:
            intent = "coaching"

        mode = plan.get("mode", "coach")
        if mode not in valid_modes:
            mode = "coach"

        sources = plan.get("knowledge_sources", ["user_memory"])
        depth = max(1, min(3, int(plan.get("depth", 2))))
        budget = max(100, min(600, int(plan.get("token_budget", 300))))
        needs_reflection = plan.get("needs_reflection", False)

        return ClassifyResponse(
            intent=intent,
            mode=mode,
            knowledge_sources=sources,
            depth=depth,
            token_budget=budget,
            needs_reflection=bool(needs_reflection),
            reasoning=plan.get("reasoning", ""),
        )

    except (json.JSONDecodeError, Exception):
        # Fast fallback — no LLM needed
        return _rule_based_classify(request.message)


# ═══════════════════════════════════════════════════════════════
# SELF-REFLECTION ENGINE
# Lightweight second-pass that checks response quality.
# Only runs for complex queries (needs_reflection=true).
# ═══════════════════════════════════════════════════════════════

REFLECT_PROMPT = """/no_think
You are a quality checker for a fitness AI coach's response. Evaluate and optionally revise.

CHECK:
1. Factual accuracy — any obvious wrong claims?
2. Memory consistency — does it contradict known user facts?
3. Safety — any dangerous exercise advice for someone with injuries?
4. Completeness — did it answer what was asked?
5. Tone match — does it match the user's preferred style?
6. Verbosity — is it appropriately sized?

USER FACTS (if any):
{user_facts}

SCORING (1-10):
- 9-10: Excellent, return as-is
- 7-8: Good, minor improvements possible
- 5-6: Needs revision
- 1-4: Regenerate

RESPOND WITH ONLY JSON:
{"score": 8, "issues": [], "revised_response": null, "safe": true}

If score >= 8: set revised_response to null (keep original).
If score < 8: provide the full revised_response text.
If unsafe (dangerous for user's injuries): set safe=false and provide safe alternative."""


class ReflectRequest(BaseModel):
    user_message: str
    ai_response: str
    user_facts: List[str] = []
    intent: str = "coaching"
    mode: str = "coach"


class ReflectResponse(BaseModel):
    score: int
    issues: List[str]
    revised_response: Optional[str]
    safe: bool


@router.post("/reflect", response_model=ReflectResponse)
async def reflect_on_response(request: ReflectRequest):
    """Self-reflection: check response quality and optionally revise."""
    try:
        facts_str = "\n".join(f"- {f}" for f in request.user_facts[:10]) if request.user_facts else "None provided"
        prompt = REFLECT_PROMPT.replace("{user_facts}", facts_str)

        response = await ollama.generate_json(
            prompt=f"User asked: \"{request.user_message}\"\n\nAI responded:\n\"{request.ai_response}\"\n\nIntent: {request.intent}\nMode: {request.mode}\n\nEvaluate:",
            system=prompt,
            model="evaluator",
        )

        result = json.loads(response)

        return ReflectResponse(
            score=max(1, min(10, int(result.get("score", 8)))),
            issues=result.get("issues", []),
            revised_response=result.get("revised_response"),
            safe=result.get("safe", True),
        )

    except Exception:
        # If reflection fails, pass through original (safe default)
        return ReflectResponse(score=8, issues=[], revised_response=None, safe=True)


# ═══════════════════════════════════════════════════════════════
# GOAL TRAJECTORY ANALYSIS
# Detect behavioral patterns from episodic data.
# ═══════════════════════════════════════════════════════════════

TRAJECTORY_PROMPT = """/no_think
Analyze this user's fitness behavior patterns and provide coaching insights.

USER DATA:
{user_data}

Identify:
1. Positive trends (consistency, improvement)
2. Concerning patterns (declining, skipping, burnout risk)
3. Coaching adjustment recommendations

RESPOND WITH ONLY JSON:
{"positive_trends": ["..."], "concerns": ["..."], "coaching_adjustments": ["..."], "overall_trajectory": "improving|stable|declining|insufficient_data"}"""


class TrajectoryRequest(BaseModel):
    session_summaries: List[str] = []
    topic_frequency: dict = {}
    progress_entries: List[dict] = []
    total_sessions: int = 0
    satisfaction_rate: float = 0.0


class TrajectoryResponse(BaseModel):
    positive_trends: List[str]
    concerns: List[str]
    coaching_adjustments: List[str]
    overall_trajectory: str


@router.post("/trajectory", response_model=TrajectoryResponse)
async def analyze_trajectory(request: TrajectoryRequest):
    """Analyze user's goal trajectory and behavioral patterns."""
    try:
        data_parts = []
        if request.session_summaries:
            data_parts.append("Recent sessions:\n" + "\n".join(f"- {s}" for s in request.session_summaries[-10:]))
        if request.topic_frequency:
            top = sorted(request.topic_frequency.items(), key=lambda x: x[1], reverse=True)[:10]
            data_parts.append("Topic frequency: " + ", ".join(f"{k}={v}" for k, v in top))
        if request.progress_entries:
            data_parts.append("Progress: " + str(request.progress_entries[-10:]))
        data_parts.append(f"Total sessions: {request.total_sessions}, Satisfaction: {request.satisfaction_rate:.0%}")

        user_data = "\n".join(data_parts) if data_parts else "Insufficient data"
        prompt = TRAJECTORY_PROMPT.replace("{user_data}", user_data)

        response = await ollama.generate_json(
            prompt="Analyze the user's fitness trajectory:",
            system=prompt,
            model="fast",
        )

        result = json.loads(response)

        return TrajectoryResponse(
            positive_trends=result.get("positive_trends", []),
            concerns=result.get("concerns", []),
            coaching_adjustments=result.get("coaching_adjustments", []),
            overall_trajectory=result.get("overall_trajectory", "insufficient_data"),
        )

    except Exception:
        return TrajectoryResponse(
            positive_trends=[], concerns=[], coaching_adjustments=[],
            overall_trajectory="insufficient_data",
        )


# ═══════════════════════════════════════════════════════════════
# RULE-BASED FAST FALLBACK
# ═══════════════════════════════════════════════════════════════

def _rule_based_classify(message: str) -> ClassifyResponse:
    """Fast keyword-based intent classification (no LLM needed)."""
    msg = message.lower().strip()

    # Greeting / casual
    if any(w in msg for w in ["hi", "hello", "hey", "sup", "what's up", "thanks", "thank you", "bye"]):
        return ClassifyResponse(intent="casual_chat", mode="concise", knowledge_sources=["none"], depth=1, token_budget=150, needs_reflection=False, reasoning="greeting/casual")

    # Injury / pain
    if any(w in msg for w in ["hurt", "pain", "injury", "sore", "strain", "ache", "torn", "swollen"]):
        return ClassifyResponse(intent="injury_concern", mode="supportive", knowledge_sources=["user_memory", "exercise_db"], depth=2, token_budget=400, needs_reflection=True, reasoning="injury keywords")

    # Workout planning
    if any(w in msg for w in ["workout", "routine", "split", "program", "exercise", "train", "sets", "reps", "build"]):
        return ClassifyResponse(intent="workout_planning", mode="planner", knowledge_sources=["user_memory", "exercise_db"], depth=3, token_budget=500, needs_reflection=True, reasoning="workout keywords")

    # Nutrition
    if any(w in msg for w in ["diet", "eat", "calorie", "macro", "protein", "meal", "food", "nutrition", "supplement"]):
        return ClassifyResponse(intent="nutrition_question", mode="technical", knowledge_sources=["user_memory", "nutrition_db"], depth=2, token_budget=400, needs_reflection=True, reasoning="nutrition keywords")

    # Form correction
    if any(w in msg for w in ["form", "technique", "how to do", "how do i", "proper way", "correct form"]):
        return ClassifyResponse(intent="form_correction", mode="technical", knowledge_sources=["user_memory", "exercise_db"], depth=2, token_budget=400, needs_reflection=True, reasoning="form keywords")

    # Progress
    if any(w in msg for w in ["progress", "plateau", "stall", "improve", "pr", "max", "track"]):
        return ClassifyResponse(intent="progress_analysis", mode="coach", knowledge_sources=["user_memory", "episodic_memory"], depth=2, token_budget=400, needs_reflection=False, reasoning="progress keywords")

    # Motivation / emotional
    if any(w in msg for w in ["motivat", "tired", "give up", "can't", "frustrated", "burnout", "stressed", "lazy"]):
        return ClassifyResponse(intent="emotional_support", mode="supportive", knowledge_sources=["user_memory", "episodic_memory"], depth=2, token_budget=300, needs_reflection=False, reasoning="emotional keywords")

    # Memory recall
    if any(w in msg for w in ["remember", "you know", "my goal", "what do you know", "my weight"]):
        return ClassifyResponse(intent="memory_recall", mode="concise", knowledge_sources=["user_memory"], depth=1, token_budget=200, needs_reflection=False, reasoning="memory recall")

    # Default: coaching
    return ClassifyResponse(intent="coaching", mode="coach", knowledge_sources=["user_memory"], depth=2, token_budget=300, needs_reflection=False, reasoning="default coaching")
