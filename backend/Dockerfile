FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

# Crear usuario no-root de producción
RUN addgroup --system hiporeal && adduser --system --ingroup hiporeal hiporeal

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

# Normalizar finales de línea LF (protección Windows CRLF -> Linux) y permisos
RUN sed -i 's/\r$//' /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh && \
    chown -R hiporeal:hiporeal /app

USER hiporeal

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
