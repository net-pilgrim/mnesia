"""Embedding generator with graceful fallback."""

import logging
from typing import List, Optional
from openai import OpenAI
from config import settings

logger = logging.getLogger(__name__)

_openai_client: Optional[OpenAI] = None


def get_openai_client() -> Optional[OpenAI]:
    global _openai_client
    if _openai_client is None and settings.openai_api_key:
        _openai_client = OpenAI(api_key=settings.openai_api_key)
    return _openai_client


def generate_embedding(text: str) -> Optional[List[float]]:
    """Generate vector embedding for the given text.
    
    Returns None if OpenAI is not configured or if an error occurs.
    """
    client = get_openai_client()
    if not client:
        return None

    try:
        # Clean text
        sanitized = text.replace("\n", " ").strip()
        if not sanitized:
            return None

        response = client.embeddings.create(
            input=[sanitized],
            model=settings.embedding_model,
            dimensions=settings.embedding_dimensions,
        )
        return response.data[0].embedding
    except Exception as e:
        logger.warning("Failed to generate embedding: %s. Falling back to text mode.", e)
        return None
