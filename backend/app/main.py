"""
Vertex API — точка входа.
Запуск:  uvicorn app.main:app --reload
Документация автоматически: http://127.0.0.1:8000/docs
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .routes import router

app = FastAPI(
    title="Vertex API",
    description="Бэкенд приложения личных финансов Vertex",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/")
def root():
    return {"service": "Vertex API", "docs": "/docs", "health": "/api/health"}