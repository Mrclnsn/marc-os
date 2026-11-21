"""Spraak naar tekst voor Hermes (Marc OS, gesprek 13).

Kleine OpenAI-compatibele server: POST /v1/audio/transcriptions (multipart: file, model, language,
response_format) met faster-whisper op de CPU. Hermes gebruikt hem als STT-provider "openai" met
base_url http://stt:8000/v1. Alleen op het interne Docker-netwerk; de API-sleutel moet kloppen.
Alleen standaardbibliotheek plus faster-whisper.
"""

import email.parser
import email.policy
import json
import logging
import os
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stt")

MODEL = os.environ.get("STT_MODEL", "small")
LANGUAGE = os.environ.get("STT_LANGUAGE", "nl")
THREADS = int(os.environ.get("STT_THREADS", "2"))
API_KEY = os.environ.get("STT_API_KEY", "")
MAX_BYTES = 25 * 1024 * 1024
FAKE = os.environ.get("STT_FAKE") == "1"  # alleen voor tests: geen model, vaste tekst

_model = None
_model_lock = threading.Lock()
_work_lock = threading.Lock()  # één omzetting tegelijk: de VPS heeft 2 vCPU's
_status = {"model": MODEL, "ready": False, "error": None}


def get_model():
    global _model
    with _model_lock:
        if _model is None and not FAKE:
            from faster_whisper import WhisperModel

            t = time.time()
            log.info("Model %s laden (eerste keer: ophalen, ca. 500 MB)...", MODEL)
            _model = WhisperModel(MODEL, device="cpu", compute_type="int8", cpu_threads=THREADS)
            log.info("Model %s klaar in %.0f s", MODEL, time.time() - t)
        _status["ready"] = True
        return _model


def preload():
    try:
        get_model()
    except Exception as e:  # noqa: BLE001
        _status["error"] = str(e)
        log.exception("Model laden mislukt")


def transcribe(path: str, language: str | None) -> str:
    if FAKE:
        return f"test transcriptie ({os.path.getsize(path)} bytes, taal {language or LANGUAGE})"
    model = get_model()
    with _work_lock:
        segments, _info = model.transcribe(path, language=language or LANGUAGE, beam_size=5, vad_filter=True)
        return " ".join(s.text.strip() for s in segments).strip()


def parse_multipart(content_type: str, body: bytes) -> dict:
    msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(
        b"Content-Type: " + content_type.encode() + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
    )
    fields: dict = {}
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if not name:
            continue
        payload = part.get_payload(decode=True) or b""
        if part.get_filename():
            fields[name] = (part.get_filename(), payload)
        else:
            fields[name] = payload.decode("utf-8", "replace")
    return fields


class Handler(BaseHTTPRequestHandler):
    server_version = "marcos-stt/1"

    def log_message(self, fmt, *args):  # geen inhoud of paden in het logboek
        pass

    def _send(self, code: int, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else (json.dumps(body) if ctype == "application/json" else str(body)).encode()
        self.send_response(code)
        self.send_header("Content-Type", f"{ctype}; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _error(self, code: int, message: str):
        self._send(code, {"error": {"message": message, "type": "invalid_request_error"}})

    def do_GET(self):
        if self.path in ("/health", "/v1/health"):
            return self._send(200, {"status": "ok", **_status})
        if self.path == "/v1/models":
            return self._send(200, {"object": "list", "data": [{"id": "whisper-1", "object": "model"}, {"id": MODEL, "object": "model"}]})
        self._error(404, "Niet gevonden")

    def do_POST(self):
        if self.path.rstrip("/") not in ("/v1/audio/transcriptions", "/audio/transcriptions"):
            return self._error(404, "Niet gevonden")
        if API_KEY and self.headers.get("Authorization", "") != f"Bearer {API_KEY}":
            return self._error(401, "Ongeldige sleutel")
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BYTES:
            return self._error(413 if length > MAX_BYTES else 400, "Bestand ontbreekt of is te groot")
        ctype = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in ctype:
            return self._error(400, "Verwacht multipart/form-data")
        fields = parse_multipart(ctype, self.rfile.read(length))
        if not isinstance(fields.get("file"), tuple):
            return self._error(400, "Veld 'file' ontbreekt")
        filename, data = fields["file"]
        language = (fields.get("language") or "").strip() or None
        fmt = (fields.get("response_format") or "json").strip()
        suffix = os.path.splitext(filename or "")[1][:10] or ".ogg"
        t = time.time()
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix) as f:
                f.write(data)
                f.flush()
                text = transcribe(f.name, language)
        except Exception as e:  # noqa: BLE001
            log.exception("Omzetten mislukt")
            return self._send(500, {"error": {"message": f"Omzetten mislukt: {e}", "type": "server_error"}})
        log.info("Omgezet: %d KB in %.1f s, %d tekens", len(data) // 1024, time.time() - t, len(text))
        if fmt == "text":
            return self._send(200, text, "text/plain")
        if fmt == "verbose_json":
            return self._send(200, {"text": text, "language": language or LANGUAGE, "segments": []})
        self._send(200, {"text": text})


if __name__ == "__main__":
    threading.Thread(target=preload, daemon=True).start()
    srv = ThreadingHTTPServer(("0.0.0.0", 8000), Handler)
    log.info("STT-server op :8000 (model %s, taal %s)", MODEL, LANGUAGE)
    srv.serve_forever()
