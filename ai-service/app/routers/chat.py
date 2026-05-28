from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from app.models.schemas import ChatRequest, ChatResponse
from app.core.llm import ollama
from app.core.cache import cache_get, cache_set
import json as _json
import logging
  
logger = logging.getLogger("getfit-ai")

router = APIRouter()

SYSTEM_PROMPT = """You are Kyro, the GetFit AI coach. CSCS-certified personal trainer, injury prevention specialist, 15+ years experience. Introduce yourself as Kyro when greeting users.

EXPERTISE: Exercise science, biomechanics, periodization, progressive overload, hypertrophy (MEV/MAV/MRV), strength (powerlifting, RPE/RIR), body composition, all equipment types. Injury prevention: rotator cuff, lower back, knee, elbow, shoulder issues. Form correction, rehab progressions, mobility, overtraining detection. Nutrition: macros, protein timing, carb cycling, evidence-based supplements. Recovery: sleep, hydration, stress.

RULES:
1. Plain text only. No markdown (no **, ##, ---, `, bullet symbols). Use line breaks and numbering.
2. Short and precise: 4-8 lines for simple questions. Longer only when user asks for detail/programs/plans.
3. Answer EXACTLY what's asked. No unsolicited extras.
4. Use concrete numbers (sets x reps, rest, RPE) only when asked for programs.
5. Form questions: 3-5 cues + 1-2 common mistakes.
6. Injury: likely cause, immediate steps, when to see doctor. Never diagnose.
7. Metric units (kg, cm) by default. Personalize if context provided.
8. Be direct/honest. Stay on fitness/nutrition/wellness topics.
9. No emojis unless user uses them. Don't repeat the question.

TONE & READABILITY:
- Sound like a knowledgeable friend, not a textbook. Conversational, clear, zero filler.
- Lead with the answer, then explain briefly. Never bury the key point.
- Vary sentence structure. Avoid starting consecutive sentences with the same word.
- For actionable advice: state the action first, then the reason.
- Use natural transitions between points. Avoid numbered lists unless the user asks for a plan.
- Never use phrases: "Great question!", "That's a great point!", "Absolutely!", "Let me explain", "Sure thing!".
- Greetings: Keep it to 1-2 short sentences. Just greet back warmly + ask how you can help. Do NOT launch into plans, stats, or recommendations unless asked."""


# ═══ RESPONSE MODE OVERLAYS ═══
MODE_PROMPTS = {
    "coach": "MODE: Warm, personalized, action-oriented. Practical advice for today. Reference goals/history.",
    "technical": "MODE: Precise, evidence-based. Cite exercise science. Use specific numbers.",
    "supportive": "MODE: Empathetic, encouraging. Acknowledge feelings before advising. Be gentle.",
    "concise": "MODE: Shortest useful answer. 1-3 sentences max. No fluff.",
    "planner": "MODE: Structured plans with numbered lists. Specific sets/reps/rest or meals/macros.",
    "corrective": "MODE: User is correcting you. Acknowledge gracefully. Update understanding. Not defensive.",
}


@router.post("/completions", response_model=ChatResponse)
async def chat_completion(request: ChatRequest):
    try:
        # ── Semantic cache check ──
        user_query = request.messages[-1].content if request.messages else ""
        intent = request.intent or "coaching"
        query_embedding = None

        try:
            query_embedding = await ollama.embed(user_query)
            cached = await cache_get(user_query, intent, query_embedding)
            if cached:
                logger.info(f"Cache {cached['cache']} hit (sim={cached['similarity']:.2f})")
                return ChatResponse(content=cached["content"], role="assistant")
        except Exception:
            pass  # cache miss or error → generate normally

        messages = _build_messages(request)
        response = await ollama.chat(messages)

        # ── Store in cache (non-blocking) ──
        try:
            await cache_set(user_query, intent, response, query_embedding)
        except Exception:
            pass

        return ChatResponse(content=response, role="assistant")

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM error: {str(e)}")


def _build_messages(request: ChatRequest) -> list[dict]:
    """Build message list with a SINGLE merged system message for minimal prompt eval.
    
    Merging N system messages into 1 reduces Ollama prompt processing overhead.
    """
    parts = [SYSTEM_PROMPT]

    # Mode overlay
    mode = request.response_mode or "coach"
    if mode in MODE_PROMPTS:
        parts.append(MODE_PROMPTS[mode])

    # Token budget instruction
    if request.token_budget <= 200:
        parts.append("IMPORTANT: Keep response under 3-4 sentences. Be extremely concise.")
    elif request.token_budget >= 450:
        parts.append("You may give a detailed, comprehensive response.")

    # User profile context
    if request.user_context:
        ctx = request.user_context
        profile_fields = [f"{k}={v}" for k, v in ctx.items() if v is not None and k not in ("preferredResponseLength", "styleTechnicality", "styleMotivation", "styleVerbosity", "avoid", "prefer", "historicalQuality", "preferredStructure")]
        if profile_fields:
            parts.append("User: " + ", ".join(profile_fields))

    # Memory context
    if request.compiled_memories:
        parts.append(f"MEMORY:\n{request.compiled_memories}\nUse naturally. Never mention memory system.")
    elif request.user_memories:
        parts.append("FACTS:\n" + "\n".join(f"- {m}" for m in request.user_memories[:12]) + "\nUse naturally.")

    # Behavior/style preferences (compact)
    if request.user_context:
        bp = []
        pref = request.user_context.get("preferredResponseLength")
        if pref == "short": bp.append("Short responses (3-5 lines).")
        elif pref == "detailed": bp.append("Detailed responses.")

        tech = request.user_context.get("styleTechnicality")
        if tech is not None and tech > 0.7: bp.append("Technical language.")
        elif tech is not None and tech < 0.3: bp.append("Casual language.")

        motiv = request.user_context.get("styleMotivation")
        if motiv is not None and motiv < 0.3: bp.append("Direct, no fluff.")
        elif motiv is not None and motiv > 0.7: bp.append("Encouraging tone.")

        avoid = request.user_context.get("avoid")
        if avoid: bp.append(f"AVOID: {avoid}")
        prefer = request.user_context.get("prefer")
        if prefer: bp.append(f"PREFER: {prefer}")

        if bp:
            parts.append("STYLE: " + " ".join(bp))

    # Hallucination guard for risky domains
    intent = request.intent or "coaching"
    GROUNDED_INTENTS = {"nutrition_question", "injury_concern", "factual_query", "form_correction"}
    if intent in GROUNDED_INTENTS:
        parts.append("GROUNDING: For calories, macros, supplements, injuries, and exercise facts — only state what you are confident about. If data was provided in CONTEXT below, reference those numbers. Do not invent specific calorie counts, dosages, or medical claims. Say 'I'm not sure' rather than guess.")

    # Enriched context (tools + reasoning + trajectory)
    if request.trajectory_context:
        parts.append(f"CONTEXT:\n{request.trajectory_context}\nUse data accurately. Don't mention tools/trajectory explicitly.")

    # Single merged system message
    messages = [{"role": "system", "content": "\n\n".join(parts)}]

    for msg in request.messages:
        messages.append({"role": msg.role, "content": msg.content})

    return messages


# Intents that are simple enough to skip reasoning
FAST_INTENTS = {"casual_chat", "memory_recall", "motivation", "greeting"}
# Intents that need full reasoning depth
DEEP_INTENTS = {"workout_planning", "nutrition_question", "injury_concern", "progress_analysis", "recovery_analysis"}

# Context window per depth tier
CTX_TIERS = {"fast": 2048, "medium": 4096, "deep": 6144}


@router.post("/stream")
async def chat_stream(request: ChatRequest):
    """Stream chat response tokens via SSE with adaptive reasoning depth.
    
    Fast intents: /no_think + small context (target <2s first token)
    Medium intents: normal reasoning + medium context
    Deep intents: full reasoning + larger context (maintain quality)
    """
    try:
        intent = request.intent or "coaching"
        user_query = request.messages[-1].content if request.messages else ""

        # ── Cache check (instant return if hit) ──
        try:
            q_emb = await ollama.embed(user_query)
            cached = await cache_get(user_query, intent, q_emb)
            if cached:
                logger.info(f"Stream cache {cached['cache']} hit")
                async def cached_generator():
                    yield f"data: {_json.dumps({'type': 'tier', 'tier': 'cached'})}\n\n"
                    # Send cached content in small chunks for natural feel
                    words = cached["content"].split(" ")
                    chunk = ""
                    for w in words:
                        chunk += w + " "
                        if len(chunk) > 20:
                            yield f"data: {_json.dumps({'token': chunk})}\n\n"
                            chunk = ""
                    if chunk:
                        yield f"data: {_json.dumps({'token': chunk})}\n\n"
                    yield f"data: {_json.dumps({'done': True})}\n\n"
                return StreamingResponse(
                    cached_generator(),
                    media_type="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
                )
        except Exception:
            q_emb = None  # cache miss → generate

        messages = _build_messages(request)

        # Determine reasoning tier
        if intent in FAST_INTENTS or (request.token_budget and request.token_budget <= 150):
            tier = "fast"
        elif intent in DEEP_INTENTS:
            tier = "deep"
        else:
            tier = "medium"

        # Adaptive /no_think: only for fast tier
        if tier == "fast":
            for i in range(len(messages) - 1, -1, -1):
                if messages[i]["role"] == "user":
                    messages[i]["content"] = "/no_think " + messages[i]["content"]
                    break

        ctx_window = CTX_TIERS.get(tier, 4096)

        collected_tokens = []
        import time as _time

        async def event_generator():
            t_start = _time.time()
            t_first_token = 0
            token_count = 0

            try:
                yield f"data: {_json.dumps({'type': 'tier', 'tier': tier})}\n\n"
                async for token in ollama.chat_stream(messages, num_ctx=ctx_window):
                    if not t_first_token:
                        t_first_token = _time.time()
                    token_count += 1
                    collected_tokens.append(token)
                    yield f"data: {_json.dumps({'token': token})}\n\n"

                t_done = _time.time()
                gen_duration = t_done - (t_first_token or t_start)
                tokens_per_sec = token_count / gen_duration if gen_duration > 0 else 0

                yield f"data: {_json.dumps({'done': True, 'perf': {'first_token_ms': round((t_first_token - t_start) * 1000) if t_first_token else None, 'total_ms': round((t_done - t_start) * 1000), 'tokens': token_count, 'tokens_per_sec': round(tokens_per_sec, 1)}})}\n\n"

                # Cache the completed response
                full_response = "".join(collected_tokens)
                if full_response and len(full_response) > 20:
                    try:
                        emb = q_emb or await ollama.embed(user_query)
                        await cache_set(user_query, intent, full_response, emb)
                    except Exception:
                        pass
            except Exception as e:
                yield f"data: {_json.dumps({'error': str(e)})}\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stream error: {str(e)}")
