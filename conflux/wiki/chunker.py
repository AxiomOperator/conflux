from __future__ import annotations

from dataclasses import dataclass

CHUNK_SIZE = 800
CHUNK_OVERLAP = 100


@dataclass
class Chunk:
    text: str
    page_id: str
    chunk_index: int
    source_title: str


def chunk_text(text: str, page_id: str, title: str) -> list[Chunk]:
    """Split text into overlapping chunks of roughly ``CHUNK_SIZE`` chars."""
    if not text or not text.strip():
        return []

    normalized = text.strip()
    chunks: list[Chunk] = []
    start = 0
    chunk_index = 0

    while start < len(normalized):
        end = min(start + CHUNK_SIZE, len(normalized))
        if end < len(normalized):
            for separator in ('\n\n', '\n', '. ', ' '):
                position = normalized.rfind(separator, start, end)
                if position > start + CHUNK_SIZE // 2:
                    end = position + len(separator)
                    break

        chunk_body = normalized[start:end].strip()
        if chunk_body:
            chunks.append(
                Chunk(
                    text=chunk_body,
                    page_id=page_id,
                    chunk_index=chunk_index,
                    source_title=title,
                )
            )
            chunk_index += 1

        if end >= len(normalized):
            break

        start = max(end - CHUNK_OVERLAP, start + 1)

    return chunks
