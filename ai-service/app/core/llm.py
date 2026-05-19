import httpx
from app.core.config import settings


class OllamaClient:
    """Async client for Ollama LLM server."""

    def __init__(self):
        self.base_url = settings.OLLAMA_BASE_URL
        self.model = settings.OLLAMA_MODEL
        self.embed_model = settings.OLLAMA_EMBED_MODEL
        self.client = httpx.AsyncClient(timeout=180.0)

    async def chat(self, messages: list[dict], temperature: float = 0.7, model: str | None = None) -> str:
        """Send a multi-turn chat request and return the assistant reply."""
        response = await self.client.post(
            f"{self.base_url}/api/chat",
            json={
                "model": model or self.model,
                "messages": messages,
                "stream": False,
                "options": {"temperature": temperature},
            },
        )
        response.raise_for_status()
        return response.json()["message"]["content"]

    async def generate(self, prompt: str, system: str | None = None, temperature: float = 0.7) -> str:
        """Single-turn generation with optional system prompt."""
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        return await self.chat(messages, temperature=temperature)

    async def generate_json(self, prompt: str, system: str | None = None) -> str:
        """Generate with JSON format enforced."""
        response = await self.client.post(
            f"{self.base_url}/api/chat",
            json={
                "model": self.model,
                "messages": [
                    *([ {"role": "system", "content": system} ] if system else []),
                    {"role": "user", "content": prompt},
                ],
                "stream": False,
                "format": "json",
                "options": {"temperature": 0.4},
            },
        )
        response.raise_for_status()
        return response.json()["message"]["content"]

    async def embed(self, text: str) -> list[float]:
        """Generate embedding vector for text using nomic-embed-text."""
        response = await self.client.post(
            f"{self.base_url}/api/embed",
            json={"model": self.embed_model, "input": text},
        )
        response.raise_for_status()
        return response.json()["embeddings"][0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts in one call."""
        response = await self.client.post(
            f"{self.base_url}/api/embed",
            json={"model": self.embed_model, "input": texts},
        )
        response.raise_for_status()
        return response.json()["embeddings"]

    async def health_check(self) -> dict:
        """Check if Ollama is reachable and which models are loaded."""
        try:
            response = await self.client.get(f"{self.base_url}/api/tags")
            if response.status_code == 200:
                models = [m["name"] for m in response.json().get("models", [])]
                return {"status": "ok", "models": models, "target_model": self.model}
            return {"status": "error", "detail": f"HTTP {response.status_code}"}
        except Exception as e:
            return {"status": "unreachable", "detail": str(e)}


# Singleton instance used across the app
ollama = OllamaClient()
