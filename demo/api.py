"""FastAPI sidecar for TTS — accepts text, returns WAV audio.

Run:
    uvicorn demo.api:app --port 8080

Endpoints:
    POST /tts         — full text, single WAV response
    POST /tts/stream  — multipart: one WAV chunk per sentence, with index header
    GET  /health      — liveness
"""

import base64
import hashlib
import io
import re
from pathlib import Path

import numpy as np
import soundfile as sf
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from bs4 import BeautifulSoup

from document_to_speech.inference.model_loaders import load_tts_model, TTSModel
from document_to_speech.inference.text_to_speech import text_to_speech
from document_to_speech.preprocessing.data_cleaners import clean_html
from document_to_speech.types import SpeechParams

app = FastAPI(title="Document-To-Speech API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
    expose_headers=["X-Sentence-Index", "X-Sentence-Count"],
)

_tts_model: TTSModel | None = None
SAMPLE_RATE = 24000
BOUNDARY = b"tts_boundary"

CACHE_DIR = Path(__file__).parent / "tts_cache"
CACHE_DIR.mkdir(exist_ok=True)


def _cache_key(sentence: str, voice: str, speed: float) -> str:
    return hashlib.sha256(f"{sentence}|{voice}|{speed:.2f}".encode()).hexdigest()


def _get_cached(sentence: str, voice: str, speed: float) -> bytes | None:
    path = CACHE_DIR / f"{_cache_key(sentence, voice, speed)}.wav"
    return path.read_bytes() if path.exists() else None


def _set_cached(sentence: str, voice: str, speed: float, wav: bytes) -> None:
    (CACHE_DIR / f"{_cache_key(sentence, voice, speed)}.wav").write_bytes(wav)


def get_tts_model() -> TTSModel:
    global _tts_model
    if _tts_model is None:
        _tts_model = load_tts_model("hexgrad/Kokoro-82M", lang_code="a")
    return _tts_model


def split_sentences(text: str) -> list[str]:
    """Split text into sentences, filtering blanks and very short fragments."""
    parts = re.split(r'(?<=[.!?])\s+', text.strip())
    return [s.strip() for s in parts if len(s.strip()) > 3]


def audio_to_wav_bytes(audio: np.ndarray) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, audio, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return buf.getvalue()


class TTSRequest(BaseModel):
    text: str
    voice_profile: str = "af_sarah"
    speed: float = 1.0
    volume: float = 1.0


@app.post("/tts")
def tts(request: TTSRequest) -> StreamingResponse:
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="text must not be empty")

    model = get_tts_model()
    speech_params = SpeechParams(speed=request.speed, volume=request.volume)

    audio: np.ndarray = text_to_speech(
        input_text=request.text,
        model=model,
        voice_profile=request.voice_profile,
        speech_params=speech_params,
    )

    if audio.size == 0:
        raise HTTPException(status_code=500, detail="TTS produced no audio")

    buf = io.BytesIO(audio_to_wav_bytes(audio))
    return StreamingResponse(
        buf,
        media_type="audio/wav",
        headers={"Content-Disposition": 'attachment; filename="speech.wav"'},
    )


@app.post("/tts/stream")
def tts_stream(request: TTSRequest) -> StreamingResponse:
    """
    Multipart response — one WAV part per sentence.
    Each part has headers:
        X-Sentence-Index: <0-based int>
        X-Sentence-Count: <total>
    Tampermonkey reads these to sync highlights.
    """
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="text must not be empty")

    sentences = split_sentences(request.text)
    if not sentences:
        raise HTTPException(status_code=400, detail="no sentences found in text")

    model = get_tts_model()
    speech_params = SpeechParams(speed=request.speed, volume=request.volume)
    total = len(sentences)

    def generate():
        for idx, sentence in enumerate(sentences):
            wav_bytes = _get_cached(sentence, request.voice_profile, request.speed)
            if wav_bytes is None:
                try:
                    audio = text_to_speech(
                        input_text=sentence,
                        model=model,
                        voice_profile=request.voice_profile,
                        speech_params=speech_params,
                    )
                except Exception:
                    continue
                if audio.size == 0:
                    continue
                wav_bytes = audio_to_wav_bytes(audio)
                _set_cached(sentence, request.voice_profile, request.speed, wav_bytes)

            sentence_b64 = base64.b64encode(sentence.encode()).decode()
            part = (
                f"--{BOUNDARY.decode()}\r\n"
                f"Content-Type: audio/wav\r\n"
                f"X-Sentence-Index: {idx}\r\n"
                f"X-Sentence-Count: {total}\r\n"
                f"X-Sentence-Text: {sentence_b64}\r\n"
                f"Content-Length: {len(wav_bytes)}\r\n"
                f"\r\n"
            ).encode() + wav_bytes + b"\r\n"

            yield part

        yield f"--{BOUNDARY.decode()}--\r\n".encode()

    return StreamingResponse(
        generate(),
        media_type=f"multipart/mixed; boundary={BOUNDARY.decode()}",
        headers={"X-Total-Sentences": str(total)},
    )


class HTMLRequest(BaseModel):
    html: str
    voice_profile: str = "af_sarah"
    speed: float = 1.0
    volume: float = 1.0


@app.post("/tts/from-html")
def tts_from_html(request: HTMLRequest) -> StreamingResponse:
    """
    Accept raw page HTML, clean it server-side, return multipart WAV stream.
    Tampermonkey sends document.body.innerHTML — no auth needed, page already rendered.
    """
    if not request.html.strip():
        raise HTTPException(status_code=400, detail="html must not be empty")

    text = clean_html(request.html)
    if not text.strip():
        raise HTTPException(status_code=422, detail="no readable text found in HTML")

    sentences = split_sentences(text)
    if not sentences:
        raise HTTPException(status_code=422, detail="no sentences found after cleaning")

    model = get_tts_model()
    speech_params = SpeechParams(speed=request.speed, volume=request.volume)
    total = len(sentences)

    def generate():
        for idx, sentence in enumerate(sentences):
            wav_bytes = _get_cached(sentence, request.voice_profile, request.speed)
            if wav_bytes is None:
                try:
                    audio = text_to_speech(
                        input_text=sentence,
                        model=model,
                        voice_profile=request.voice_profile,
                        speech_params=speech_params,
                    )
                except Exception:
                    continue
                if audio.size == 0:
                    continue
                wav_bytes = audio_to_wav_bytes(audio)
                _set_cached(sentence, request.voice_profile, request.speed, wav_bytes)
            sentence_b64 = base64.b64encode(sentence.encode()).decode()
            part = (
                f"--{BOUNDARY.decode()}\r\n"
                f"Content-Type: audio/wav\r\n"
                f"X-Sentence-Index: {idx}\r\n"
                f"X-Sentence-Count: {total}\r\n"
                f"X-Sentence-Text: {sentence_b64}\r\n"
                f"Content-Length: {len(wav_bytes)}\r\n"
                f"\r\n"
            ).encode() + wav_bytes + b"\r\n"
            yield part
        yield f"--{BOUNDARY.decode()}--\r\n".encode()

    return StreamingResponse(
        generate(),
        media_type=f"multipart/mixed; boundary={BOUNDARY.decode()}",
        headers={"X-Total-Sentences": str(total)},
    )


class SentencesRequest(BaseModel):
    html: str


@app.post("/sentences")
def sentences(request: SentencesRequest):
    """Extract and return sentences from HTML without generating audio."""
    if not request.html.strip():
        raise HTTPException(status_code=400, detail="html must not be empty")
    text = clean_html(request.html)
    parts = split_sentences(text)
    return {"count": len(parts), "sentences": parts}


class ClearCacheRequest(BaseModel):
    sentences: list[str]
    voice_profile: str = "af_sarah"
    speed: float = 1.0


@app.post("/cache/clear")
def cache_clear(request: ClearCacheRequest):
    """Delete cached WAV files for the given sentences."""
    deleted = 0
    for sentence in request.sentences:
        path = CACHE_DIR / f"{_cache_key(sentence, request.voice_profile, request.speed)}.wav"
        if path.exists():
            path.unlink()
            deleted += 1
    return {"deleted": deleted, "total": len(request.sentences)}


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
