FROM python:3.11-slim-bookworm

WORKDIR /app

# Create non-root user for security
RUN useradd -m -u 1000 appuser

COPY requirements.txt requirements.txt
# All listed deps ship pre-built wheels for linux/amd64; no compiler toolchain needed.
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Change ownership and switch to non-root user
RUN chown -R appuser:appuser /app
USER appuser

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/api/health')" || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001"]
