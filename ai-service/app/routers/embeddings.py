from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
from app.core.llm import ollama
import math

router = APIRouter()


class EmbedRequest(BaseModel):
    text: str


class EmbedBatchRequest(BaseModel):
    texts: List[str]


class EmbedResponse(BaseModel):
    embedding: List[float]


class EmbedBatchResponse(BaseModel):
    embeddings: List[List[float]]


class SimilarityRequest(BaseModel):
    query_embedding: List[float]
    candidate_embeddings: List[List[float]]
    top_k: int = 10


class SimilarityResult(BaseModel):
    index: int
    score: float


class SimilarityResponse(BaseModel):
    results: List[SimilarityResult]


class CompileRequest(BaseModel):
    memories: List[str]
    max_tokens: int = 300


class CompileResponse(BaseModel):
    compiled: str
    original_count: int
    token_estimate: int


COMPILE_PROMPT = """You are a memory compiler for a fitness AI coach. Compress these user facts into a minimal, structured profile snippet.

RULES:
1. Group related facts together
2. Remove redundancy
3. Use terse key-value format
4. Preserve ALL important information — never drop safety-critical facts (allergies, injuries)
5. Output ONLY the compiled profile, no explanation

EXAMPLE INPUT:
- User likes short replies
- User dislikes motivational tone
- User likes technical detail
- User weighs 80kg
- User's goal is muscle gain
- User has lower back pain from herniated disc

EXAMPLE OUTPUT:
Profile: 80kg, goal=muscle gain
Injury: herniated disc (lower back) — avoid axial loading
Style: concise, technical, no motivational tone"""


@router.post("/embed", response_model=EmbedResponse)
async def embed_text(request: EmbedRequest):
    try:
        embedding = await ollama.embed(request.text)
        return EmbedResponse(embedding=embedding)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Embedding error: {str(e)}")


@router.post("/embed-batch", response_model=EmbedBatchResponse)
async def embed_batch(request: EmbedBatchRequest):
    try:
        if not request.texts:
            return EmbedBatchResponse(embeddings=[])
        embeddings = await ollama.embed_batch(request.texts)
        return EmbedBatchResponse(embeddings=embeddings)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batch embedding error: {str(e)}")


@router.post("/similarity", response_model=SimilarityResponse)
async def cosine_similarity_search(request: SimilarityRequest):
    """Compute cosine similarity between query and candidates. Returns top_k sorted results."""
    try:
        q = request.query_embedding
        results = []
        for i, candidate in enumerate(request.candidate_embeddings):
            score = _cosine_similarity(q, candidate)
            results.append(SimilarityResult(index=i, score=score))

        results.sort(key=lambda r: r.score, reverse=True)
        return SimilarityResponse(results=results[: request.top_k])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Similarity error: {str(e)}")


@router.post("/compile", response_model=CompileResponse)
async def compile_memories(request: CompileRequest):
    """Compress raw memory list into minimal profile snippet for prompt injection."""
    try:
        if not request.memories:
            return CompileResponse(compiled="", original_count=0, token_estimate=0)

        if len(request.memories) <= 3:
            # Too few to compile — just join
            compiled = "\n".join(f"- {m}" for m in request.memories)
            return CompileResponse(
                compiled=compiled,
                original_count=len(request.memories),
                token_estimate=len(compiled) // 4,
            )

        raw = "\n".join(f"- {m}" for m in request.memories)
        compiled = await ollama.generate(
            prompt=f"Compile these user facts:\n\n{raw}",
            system=COMPILE_PROMPT,
            temperature=0.3,
            model="compressor",
        )

        return CompileResponse(
            compiled=compiled.strip(),
            original_count=len(request.memories),
            token_estimate=len(compiled.strip()) // 4,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Compile error: {str(e)}")


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    if len(a) != len(b) or len(a) == 0:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)
