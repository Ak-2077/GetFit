import httpx
import asyncio
import re
from typing import AsyncGenerator
from app.core.config import settings

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


class OllamaClient:
    """Async client for Ollama LLM server with multi-model specialization."""

    def __init__(self):
        self.base_url = settings.OLLAMA_BASE_URL
        self.model = settings.OLLAMA_MODEL
        self.embed_model = settings.OLLAMA_EMBED_MODEL
        self.fast_model = settings.OLLAMA_FAST_MODEL
        self.evaluator_model = settings.OLLAMA_EVALUATOR_MODEL
        self.compressor_model = settings.OLLAMA_COMPRESSOR_MODEL
        self.keep_alive = settings.OLLAMA_KEEP_ALIVE
        # Connection pool for concurrent requests
        pool_limits = httpx.Limits(max_connections=20, max_keepalive_connections=10)
        self.client = httpx.AsyncClient(timeout=180.0, limits=pool_limits)
        # Shorter timeout for fast model calls
        self.fast_client = httpx.AsyncClient(timeout=30.0, limits=pool_limits)

    # ── Model role shortcuts ──
    # NUM_CTX tuned per role to minimize VRAM + latency
    MODEL_CTX = {
        "fast": 2048,       # routing/classification needs minimal context
        "main": 8192,       # full generation with rich context
        "evaluator": 4096,  # evaluation with response + facts
        "compressor": 2048, # summarization with focused input
    }

    def _get_model(self, role: str | None) -> str:
        """Resolve model name from role."""
        if role == "fast":
            return self.fast_model
        elif role == "evaluator":
            return self.evaluator_model
        elif role == "compressor":
            return self.compressor_model
        elif role == "main" or role is None:
            return self.model
        # If a specific model name is passed directly
        return role

    def _get_ctx(self, role: str | None) -> int:
        """Get optimal context window for role."""
        return self.MODEL_CTX.get(role, 8192)

    async def chat(self, messages: list[dict], temperature: float = 0.7, model: str | None = None, num_ctx: int | None = None) -> str:
        """Send a multi-turn chat request and return the assistant reply."""
        resolved_model = self._get_model(model)
        ctx = num_ctx or self._get_ctx(model)
        client = self.fast_client if model == "fast" else self.client

        response = await client.post(
            f"{self.base_url}/api/chat",
            json={
                "model": resolved_model,
                "messages": messages,
                "stream": False,
                "keep_alive": self.keep_alive,
                "options": {"temperature": temperature, "num_ctx": ctx},
            },
        )
        response.raise_for_status()
        content = response.json()["message"]["content"]
        return _THINK_RE.sub("", content).strip()

    async def chat_stream(self, messages: list[dict], temperature: float = 0.7, model: str | None = None, num_ctx: int | None = None) -> AsyncGenerator[str, None]:
        """Stream a chat response token by token."""
        resolved_model = self._get_model(model)
        ctx = num_ctx or self._get_ctx(model)

        async with self.client.stream(
            "POST",
            f"{self.base_url}/api/chat",
            json={
                "model": resolved_model,
                "messages": messages,
                "stream": True,
                "keep_alive": self.keep_alive,
                "options": {"temperature": temperature, "num_ctx": ctx},
            },
        ) as response:
            response.raise_for_status()
            import json as _json
            in_think = False
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                try:
                    chunk = _json.loads(line)
                    content = chunk.get("message", {}).get("content", "")
                    if content:
                        # Filter out <think>...</think> blocks from stream
                        if "<think>" in content:
                            in_think = True
                        if in_think:
                            if "</think>" in content:
                                in_think = False
                                # Yield any text after </think>
                                after = content.split("</think>", 1)[1]
                                if after:
                                    yield after
                            # Skip tokens inside think block
                            continue
                        yield content
                    if chunk.get("done", False):
                        return
                except _json.JSONDecodeError:
                    continue

    async def generate(self, prompt: str, system: str | None = None, temperature: float = 0.7, model: str | None = None) -> str:
        """Single-turn generation with optional system prompt."""
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        return await self.chat(messages, temperature=temperature, model=model)

    async def generate_json(self, prompt: str, system: str | None = None, model: str | None = None) -> str:
        """Generate with JSON format enforced."""
        resolved_model = self._get_model(model)
        ctx = self._get_ctx(model)
        client = self.fast_client if model == "fast" else self.client

        response = await client.post(
            f"{self.base_url}/api/chat",
            json={
                "model": resolved_model,
                "messages": [
                    *([ {"role": "system", "content": system} ] if system else []),
                    {"role": "user", "content": prompt},
                ],
                "stream": False,
                "format": "json",
                "keep_alive": self.keep_alive,
                "options": {"temperature": 0.4, "num_ctx": ctx},
            },
        )
        response.raise_for_status()
        content = response.json()["message"]["content"]
        return _THINK_RE.sub("", content).strip()

    async def embed(self, text: str) -> list[float]:
        """Generate embedding vector for text using nomic-embed-text."""
        response = await self.fast_client.post(
            f"{self.base_url}/api/embed",
            json={"model": self.embed_model, "input": text, "keep_alive": self.keep_alive},
        )
        response.raise_for_status()
        return response.json()["embeddings"][0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts in one call."""
        response = await self.client.post(
            f"{self.base_url}/api/embed",
            json={"model": self.embed_model, "input": texts, "keep_alive": self.keep_alive},
        )
        response.raise_for_status()
        return response.json()["embeddings"]

    async def warmup(self):
        """Pre-load all models into VRAM for instant first response."""
        import logging
        logger = logging.getLogger("getfit-ai")

        # Warm LLM models
        llm_models = set([self.fast_model, self.model, self.evaluator_model, self.compressor_model])
        tasks = []
        for m in llm_models:
            tasks.append(self.client.post(
                f"{self.base_url}/api/chat",
                json={"model": m, "messages": [{"role": "user", "content": "hi"}], "stream": False, "keep_alive": self.keep_alive, "options": {"num_predict": 1}},
            ))
        # Warm embedding model
        tasks.append(self.fast_client.post(
            f"{self.base_url}/api/embed",
            json={"model": self.embed_model, "input": "warmup", "keep_alive": self.keep_alive},
        ))

        results = await asyncio.gather(*tasks, return_exceptions=True)
        loaded = sum(1 for r in results if not isinstance(r, Exception) and getattr(r, 'status_code', 0) == 200)
        logger.info(f"Warmed {loaded}/{len(tasks)} models ({', '.join(llm_models | {self.embed_model})})")

    async def health_check(self) -> dict:
        """Check if Ollama is reachable and which models are loaded."""
        try:
            response = await self.client.get(f"{self.base_url}/api/tags")
            if response.status_code == 200:
                models = [m["name"] for m in response.json().get("models", [])]
                return {
                    "status": "ok", "models": models,
                    "model_roles": {
                        "fast": self.fast_model,
                        "main": self.model,
                        "evaluator": self.evaluator_model,
                        "compressor": self.compressor_model,
                        "embed": self.embed_model,
                    },
                }
            return {"status": "error", "detail": f"HTTP {response.status_code}"}
        except Exception as e:
            return {"status": "unreachable", "detail": str(e)}


# Singleton instance used across the app
ollama = OllamaClient()
