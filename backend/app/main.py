"""
Vertex API — точка входа.
Запуск:  uvicorn app.main:app --reload
Документация: http://127.0.0.1:8000/docs
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .database import init_db
from .routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # При старте сервера создаём таблицу в БД, если её ещё нет.
    await init_db()
    yield


app = FastAPI(
    title="Vertex API",
    description="Бэкенд приложения личных финансов Vertex",
    version="0.2.0",
    lifespan=lifespan,
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
