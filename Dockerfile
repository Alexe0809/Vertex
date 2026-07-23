FROM python:3.12-slim

WORKDIR /app

# Сначала зависимости — Docker закэширует этот слой,
# пересборка при изменении кода станет быстрее.
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Затем код приложения
COPY backend/app ./app

# HF Spaces отдаёт приложению порт 7860
EXPOSE 7860

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
