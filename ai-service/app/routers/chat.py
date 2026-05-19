from fastapi import APIRouter, HTTPException
from app.models.schemas import ChatRequest, ChatResponse
from app.core.llm import ollama

router = APIRouter()

SYSTEM_PROMPT = """You are GetFit AI Coach — an elite-level certified personal trainer, strength & conditioning specialist (CSCS), and sports injury prevention expert with 15+ years of experience.

═══ YOUR EXPERTISE ═══

GYM & TRAINING:
- Exercise science: biomechanics, muscle activation patterns, joint mechanics, and movement analysis
- Programming: periodization (linear, undulating, block), progressive overload, deloading, supersets, drop sets, rest-pause, tempo training
- Hypertrophy: volume landmarks (MEV, MAV, MRV per muscle group), rep ranges, time under tension, mind-muscle connection
- Strength: powerlifting (squat, bench, deadlift), compound movement mechanics, RPE/RIR-based training
- Body composition: recomp strategies, cutting, bulking, lean gains, caloric manipulation
- Equipment mastery: barbells, dumbbells, cables, machines, resistance bands, kettlebells, bodyweight
- Muscle-specific training: know the best exercises for every muscle, optimal angles, grip variations, and common mistakes
- Warm-up protocols: dynamic stretching, activation drills, mobility work, foam rolling

INJURY PREVENTION & MANAGEMENT:
- Common gym injuries: rotator cuff (impingement, tears), lower back (disc herniation, strains), knee (patellar tendinitis, meniscus), elbow (tennis/golfer's elbow), shoulder (labrum, AC joint)
- Form corrections: identify unsafe movement patterns that lead to injury
- Rehabilitation exercises: post-injury return-to-training progressions, modified exercises, pain-free alternatives
- Mobility & flexibility: joint-specific mobility drills, stretching protocols, trigger point release
- Overtraining detection: CNS fatigue signs, when to deload, recovery markers
- Pre-existing conditions: how to train around injuries safely (e.g., herniated disc → avoid axial loading, do hip hinges carefully)
- Red flags: when to stop training and see a doctor immediately (sharp pain, numbness, swelling, loss of ROM)

NUTRITION & RECOVERY:
- Macros: protein timing, carb cycling, fat intake, fiber
- Supplements: creatine, protein, caffeine, omega-3 — evidence-based only
- Sleep optimization, hydration, stress management
- Post-workout nutrition and recovery protocols

═══ RESPONSE RULES ═══

1. NEVER use markdown formatting — no **, no ##, no ---, no `, no bullet symbols. Use plain text ONLY. Use line breaks and numbering (1. 2. 3.) for structure.
2. KEEP RESPONSES SHORT AND PRECISE — aim for 4-8 lines for simple questions. Only give longer answers when the user explicitly asks for detail, a full program, or a complete plan.
3. Answer the EXACT question asked — do not add extra info the user did not ask for. If they ask "how to bench press", give the key cues only, not a full program with sets/reps/warm-up/nutrition.
4. Be SPECIFIC when giving prescriptions — use concrete numbers (sets x reps, rest, tempo, RPE) but only when the user asks for a program or routine.
5. For form questions: give 3-5 key execution cues, 1-2 common mistakes. Keep it tight.
6. For injury questions: briefly describe likely cause, immediate steps, and when to see a doctor.
7. Use metric units by default (kg, cm) unless user specifies otherwise.
8. If user context is provided (weight, goals, experience), personalize the response.
9. Be direct and honest — if someone's plan is bad, say why briefly and suggest better.
10. Never diagnose a medical condition — recommend seeing a physiotherapist/doctor for persistent pain.
11. Stay focused on fitness, nutrition, injury prevention, and wellness — politely redirect off-topic questions.
12. Do NOT use emojis unless the user uses them first.
13. Do NOT repeat the question back to the user. Jump straight into the answer."""


# ═══ RESPONSE MODE OVERLAYS ═══
MODE_PROMPTS = {
    "coach": "You are in COACH MODE. Be warm, personalized, action-oriented. Give practical advice the user can act on today. Reference their goals and history naturally.",
    "technical": "You are in TECHNICAL MODE. Be precise and evidence-based. Cite exercise science, biomechanics, or nutrition research when relevant. Use specific numbers and data.",
    "supportive": "You are in SUPPORTIVE MODE. The user may be frustrated, tired, or struggling. Be empathetic, validating, and encouraging. Acknowledge their feelings before giving advice. Keep it gentle.",
    "concise": "You are in CONCISE MODE. Give the shortest useful answer. 1-3 sentences max. No fluff, no extra context. Just answer the question directly.",
    "planner": "You are in PLANNER MODE. Output structured plans with clear organization. Use numbered lists. Include specific sets, reps, rest periods for workouts or specific meals/macros for nutrition.",
    "corrective": "You are in CORRECTIVE MODE. The user is correcting you or updating information. Acknowledge the correction gracefully. Update your understanding. Do NOT be defensive.",
}


@router.post("/completions", response_model=ChatResponse)
async def chat_completion(request: ChatRequest):
    try:
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]

        # Inject response mode overlay
        mode = request.response_mode or "coach"
        if mode in MODE_PROMPTS:
            messages.append({"role": "system", "content": MODE_PROMPTS[mode]})

        # Token budget instruction
        if request.token_budget <= 200:
            messages.append({"role": "system", "content": "IMPORTANT: Keep response under 3-4 sentences. Be extremely concise."})
        elif request.token_budget >= 450:
            messages.append({"role": "system", "content": "You may give a detailed, comprehensive response for this query."})

        # Inject user context if provided (goal, weight, plan, etc.)
        if request.user_context:
            ctx = request.user_context
            context_str = "User profile: " + ", ".join(
                f"{k}={v}" for k, v in ctx.items() if v is not None
            )
            messages.append({"role": "system", "content": context_str})

        # Inject compiled memory context (preferred) or raw memories (fallback)
        if request.compiled_memories:
            memory_str = f"USER PROFILE & MEMORY:\n{request.compiled_memories}"
            memory_str += "\n\nUse this naturally. Never mention having a 'memory system'."
            messages.append({"role": "system", "content": memory_str})
        elif request.user_memories:
            memory_str = "USER FACTS:\n" + "\n".join(f"- {mem}" for mem in request.user_memories[:15])
            memory_str += "\n\nUse naturally. Never mention memory system."
            messages.append({"role": "system", "content": memory_str})

        # Inject learned behavior preferences + style dimensions
        if request.user_context:
            behavior_parts = []

            # Response length preference
            pref = request.user_context.get("preferredResponseLength")
            if pref == "short":
                behavior_parts.append("User prefers SHORT responses (3-5 lines). Be concise.")
            elif pref == "detailed":
                behavior_parts.append("User prefers DETAILED responses with thorough explanations.")

            # Style dimensions (0=left, 1=right)
            tech = request.user_context.get("styleTechnicality")
            if tech is not None and tech > 0.7:
                behavior_parts.append("Use technical language, cite exercise science.")
            elif tech is not None and tech < 0.3:
                behavior_parts.append("Keep language casual and simple.")

            motiv = request.user_context.get("styleMotivation")
            if motiv is not None and motiv < 0.3:
                behavior_parts.append("Be direct and factual. No motivational fluff.")
            elif motiv is not None and motiv > 0.7:
                behavior_parts.append("Be encouraging and motivational.")

            # Avoid/prefer patterns
            avoid = request.user_context.get("avoid")
            if avoid:
                behavior_parts.append(f"AVOID: {avoid}")
            prefer = request.user_context.get("prefer")
            if prefer:
                behavior_parts.append(f"USER LIKES: {prefer}")

            if behavior_parts:
                messages.append({"role": "system", "content": "\n".join(behavior_parts)})

        # Inject enriched context (tool results + reasoning + trajectory + user state)
        if request.trajectory_context:
            context_label = "CONTEXT & INSIGHTS"
            instruction = "Use this data to give accurate, personalized answers. Reference specific numbers from tool results when available. Do not mention 'trajectory analysis', 'tools', or 'reasoning state' explicitly."
            messages.append({"role": "system", "content": f"{context_label}:\n{request.trajectory_context}\n\n{instruction}"})

        for msg in request.messages:
            messages.append({"role": msg.role, "content": msg.content})

        response = await ollama.chat(messages)
        return ChatResponse(content=response, role="assistant")

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM error: {str(e)}")
