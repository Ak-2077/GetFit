from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from app.core.llm import ollama
import json
import re

router = APIRouter()

# ── Production extraction prompt with hierarchy, importance, source ──
EXTRACTION_PROMPT = """You are a precision memory extraction system for a fitness AI coach. Extract KEY PERSONAL FACTS about the user from the conversation.

EACH EXTRACTED FACT MUST INCLUDE:
- fact: the specific personal fact
- category: injury | goal | preference | body_stats | experience | limitation | achievement | routine | nutrition | progress | episodic | other
- memory_type: static | evolving | temporal
- memory_level: 1 | 2 | 3 (see hierarchy below)
- importance: 1-10 (see scale below)
- confidence: 0.0-1.0 (how certain you are)
- source_type: explicit_user_statement | ai_extracted | inferred_behavior

MEMORY HIERARCHY:
- Level 1 (Core Identity): allergies, chronic injuries, fitness goal, diet type, gender, height — VERY important, rarely changes
- Level 2 (Long-term Evolving): body weight, calorie targets, workout split, sleep schedule, lift maxes, progress — changes over time
- Level 3 (Short-term Context): sore today, tired this week, traveling, temporary illness, cheat meal — expires in 24-72h

IMPORTANCE SCALE (0-10):
- 10: life-threatening (peanut allergy, heart condition)
- 9: core goal, chronic injury, medical condition
- 8: diet type (vegetarian), major limitation
- 7: response style preference, workout preferences
- 5: general facts (training frequency, experience level)
- 3: temporary context (sore today, tired)
- 1: trivial, one-off mention

SOURCE TYPES:
- explicit_user_statement: user directly said it ("I weigh 80kg", "I'm vegetarian")
- ai_extracted: inferred from context but user didn't explicitly state
- inferred_behavior: pattern detected from multiple messages

EXAMPLES:
[
  {"fact": "Allergic to peanuts", "category": "limitation", "memory_type": "static", "memory_level": 1, "importance": 10, "confidence": 0.98, "source_type": "explicit_user_statement"},
  {"fact": "Goal is muscle gain, target weight 85kg", "category": "goal", "memory_type": "evolving", "memory_level": 1, "importance": 9, "confidence": 0.9, "source_type": "explicit_user_statement"},
  {"fact": "Current body weight is 80kg", "category": "body_stats", "memory_type": "evolving", "memory_level": 2, "importance": 7, "confidence": 0.9, "source_type": "explicit_user_statement"},
  {"fact": "Feeling sore in shoulders today", "category": "other", "memory_type": "temporal", "memory_level": 3, "importance": 3, "confidence": 0.7, "source_type": "explicit_user_statement"},
  {"fact": "Seems to prefer technical explanations over motivational", "category": "preference", "memory_type": "static", "memory_level": 1, "importance": 7, "confidence": 0.6, "source_type": "inferred_behavior"}
]

DO NOT extract: general fitness knowledge, AI's own statements, vague mentions, questions without personal info.

RESPOND WITH ONLY a JSON array. No markdown:
[{"fact": "...", "category": "...", "memory_type": "...", "memory_level": 2, "importance": 5, "confidence": 0.8, "source_type": "ai_extracted"}]

If nothing personal found: []"""

# ── Conversation summarization prompt ──
SUMMARY_PROMPT = """Summarize this fitness coaching conversation in 1-2 sentences. Focus on what the user asked about and what advice was given. Also list the main topics discussed.

Respond in this exact JSON format (no markdown):
{"summary": "User asked about...", "topics": ["chest", "bench_press", "form"]}

Topics should be lowercase fitness-related keywords."""

# ── Topic detection prompt ──
TOPIC_PROMPT = """Given this user message to a fitness AI coach, identify the main fitness topics being discussed. Return ONLY a JSON array of lowercase topic keywords.

Examples:
- "How do I bench press?" → ["bench_press", "chest", "form"]
- "My shoulder hurts after overhead press" → ["shoulder", "injury", "overhead_press"]
- "What should I eat to gain muscle?" → ["nutrition", "muscle_gain", "diet"]

Respond with ONLY a JSON array: ["topic1", "topic2"]"""


# ── Models ──

class Message(BaseModel):
    role: str
    content: str


class MemoryExtractionRequest(BaseModel):
    messages: List[Message]


class ExtractedMemory(BaseModel):
    fact: str
    category: str
    memory_type: str = "static"
    memory_level: int = 2
    importance: int = 5
    confidence: float = 0.8
    source_type: str = "ai_extracted"


class MemoryExtractionResponse(BaseModel):
    memories: List[ExtractedMemory]


class SummarizationRequest(BaseModel):
    messages: List[Message]


class SummarizationResponse(BaseModel):
    summary: str
    topics: List[str]


class TopicRequest(BaseModel):
    message: str


class TopicResponse(BaseModel):
    topics: List[str]


# ── Endpoints ──

@router.post("/extract", response_model=MemoryExtractionResponse)
async def extract_memories(request: MemoryExtractionRequest):
    try:
        user_messages = [m for m in request.messages if m.role == "user"]
        if not user_messages:
            return MemoryExtractionResponse(memories=[])

        conversation = "\n".join(
            f"{m.role.upper()}: {m.content}" for m in request.messages
        )

        messages = [
            {"role": "system", "content": EXTRACTION_PROMPT},
            {"role": "user", "content": f"Extract personal facts:\n\n{conversation}"},
        ]

        response = await ollama.chat(messages, model="compressor", temperature=0.3)
        cleaned = _strip_think(_clean_json(response))
        memories = json.loads(cleaned)

        valid_categories = ["injury", "goal", "preference", "body_stats", "experience", "limitation", "achievement", "routine", "nutrition", "progress", "episodic", "other"]
        valid_types = ["static", "evolving", "temporal"]
        valid_sources = ["explicit_user_statement", "ai_extracted", "inferred_behavior"]

        result = []
        for mem in memories:
            if isinstance(mem, dict) and "fact" in mem and "category" in mem:
                cat = mem["category"] if mem["category"] in valid_categories else "other"
                mtype = mem.get("memory_type", "static")
                mtype = mtype if mtype in valid_types else "static"
                conf = max(0.0, min(1.0, float(mem.get("confidence", 0.8))))
                level = int(mem.get("memory_level", 2))
                level = level if level in [1, 2, 3] else 2
                importance = int(mem.get("importance", 5))
                importance = max(0, min(10, importance))
                source_type = mem.get("source_type", "ai_extracted")
                source_type = source_type if source_type in valid_sources else "ai_extracted"
                result.append(ExtractedMemory(
                    fact=mem["fact"], category=cat, memory_type=mtype,
                    memory_level=level, importance=importance,
                    confidence=conf, source_type=source_type,
                ))

        return MemoryExtractionResponse(memories=result)

    except json.JSONDecodeError:
        return MemoryExtractionResponse(memories=[])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Memory extraction error: {str(e)}")


@router.post("/summarize", response_model=SummarizationResponse)
async def summarize_conversation(request: SummarizationRequest):
    try:
        if len(request.messages) < 2:
            return SummarizationResponse(summary="Brief exchange", topics=[])

        conversation = "\n".join(
            f"{m.role.upper()}: {m.content}" for m in request.messages[-20:]
        )

        messages = [
            {"role": "system", "content": SUMMARY_PROMPT},
            {"role": "user", "content": conversation},
        ]

        response = await ollama.chat(messages, model="compressor", temperature=0.3)
        cleaned = _strip_think(_clean_json(response))
        data = json.loads(cleaned)

        return SummarizationResponse(
            summary=data.get("summary", "Fitness coaching conversation"),
            topics=data.get("topics", []),
        )

    except (json.JSONDecodeError, Exception):
        return SummarizationResponse(summary="Fitness coaching conversation", topics=[])


@router.post("/detect-topics", response_model=TopicResponse)
async def detect_topics(request: TopicRequest):
    try:
        messages = [
            {"role": "system", "content": TOPIC_PROMPT},
            {"role": "user", "content": request.message},
        ]
        response = await ollama.chat(messages, model="fast", temperature=0.3)
        cleaned = _strip_think(_clean_json(response))
        topics = json.loads(cleaned)

        if isinstance(topics, list):
            return TopicResponse(topics=[str(t).lower() for t in topics[:10]])
        return TopicResponse(topics=[])

    except (json.JSONDecodeError, Exception):
        return TopicResponse(topics=[])


# ── Helpers ──

def _strip_think(text: str) -> str:
    """Remove <think>...</think> blocks from Qwen3 output."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def _clean_json(response: str) -> str:
    """Strip markdown code fences, thinking blocks, and whitespace from LLM JSON output."""
    cleaned = response.strip()
    # Remove thinking blocks first
    cleaned = _strip_think(cleaned)
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()
    # Handle ```json prefix
    if cleaned.startswith("json"):
        cleaned = cleaned[4:].strip()
    return cleaned
