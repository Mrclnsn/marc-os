# Spraak naar tekst voor Hermes (gesprek 13): faster-whisper achter een kleine OpenAI-compatibele API.
# Alleen intern bereikbaar (geen poorten). Het model wordt bij de eerste start opgehaald en bewaard in /models.
FROM python:3.12-slim
# av vastgezet: PyAV 17+ kent het argument metadata_errors niet meer dat faster-whisper 1.2.1 gebruikt
RUN pip install --no-cache-dir "faster-whisper==1.2.1" "av==16.1.0" \
 && useradd -u 10001 -m stt \
 && mkdir -p /models && chown stt:stt /models
COPY server.py /app/server.py
USER stt
ENV HF_HOME=/models PYTHONUNBUFFERED=1
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"
CMD ["python", "/app/server.py"]
