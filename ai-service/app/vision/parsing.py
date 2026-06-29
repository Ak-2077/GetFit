"""
Shared parsing helpers for vision backends.
Keeps JSON extraction / garbage detection in one place.
"""

import json
import re
from .base import DetectedObject


def is_garbage(text: str) -> bool:
    """Detect tensor/embedding output or nonsense from a vision model."""
    if not text or len(text) < 3:
        return True
    alpha = sum(1 for c in text if c.isalpha())
    if len(text) > 0 and alpha / len(text) < 0.3:
        return True
    if re.match(r"^\s*\[[\d\s.,\-]+\]\s*$", text):
        return True
    return False


def extract_objects(raw_text: str) -> list[DetectedObject]:
    """Pull the {"objects": [...]} JSON block out of a model response."""
    objects: list[DetectedObject] = []
    try:
        json_match = re.search(r"```json\s*(.*?)\s*```", raw_text, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
        else:
            json_match = re.search(r"\{.*?\"objects\".*?\}", raw_text, re.DOTALL)
            json_str = json_match.group(0) if json_match else "{}"
        parsed = json.loads(json_str)
        for o in parsed.get("objects", []):
            if isinstance(o, dict) and o.get("name"):
                objects.append(DetectedObject(
                    name=str(o["name"]).strip(),
                    count=int(o.get("count", 1)) if str(o.get("count", 1)).isdigit() else 1,
                ))
    except Exception:
        pass
    return objects


def extract_structured(raw_text: str) -> dict:
    """
    Best-effort extraction of the rich JSON block produced by capable
    models (Qwen2.5-VL). Returns a dict with optional keys; missing keys
    are simply absent.
    """
    result: dict = {}
    try:
        json_match = re.search(r"```json\s*(.*?)\s*```", raw_text, re.DOTALL)
        block = json_match.group(1) if json_match else None
        if not block:
            # Try the largest {...} span
            brace = re.search(r"\{.*\}", raw_text, re.DOTALL)
            block = brace.group(0) if brace else None
        if block:
            parsed = json.loads(block)
            if isinstance(parsed, dict):
                result = parsed
    except Exception:
        pass
    return result


def strip_json_blocks(raw_text: str) -> str:
    """Remove ```json``` fenced blocks to get a clean description."""
    cleaned = re.sub(r"```json.*?```", "", raw_text, flags=re.DOTALL).strip()
    return cleaned or raw_text
