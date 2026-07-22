"""
Подключение к базе данных (Neon PostgreSQL) через SQLAlchemy async.
Секреты читаются из .env — в код не попадают.
"""
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import Column, String, Text, DateTime, func
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base

# Загружаем .env из папки backend/
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

RAW_URL = os.getenv("DATABASE_URL", "")
API_TOKEN = os.getenv("API_TOKEN", "")

# Neon даёт строку вида postgresql://... — для async-драйвера нужен префикс postgresql+asyncpg://
# Заодно убираем несовместимые с asyncpg параметры вроде sslmode / channel_binding.
def _normalize(url: str) -> str:
    if not url:
        return url
    url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    # asyncpg не понимает эти query-параметры в URL — вырезаем хвост после '?'
    if "?" in url:
        url = url.split("?", 1)[0]
    return url


DATABASE_URL = _normalize(RAW_URL)

# echo=False — не спамить SQL в консоль; pool_pre_ping — проверять живость соединения
engine = create_async_engine(DATABASE_URL, echo=False, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

Base = declarative_base()


class AppState(Base):
    """
    Одна строка = всё состояние приложения (JSON целиком).
    Для одного пользователя этого достаточно: id всегда 'main'.
    """
    __tablename__ = "app_state"

    id = Column(String, primary_key=True, default="main")
    data = Column(Text, nullable=False)  # JSON состояния как текст
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


async def init_db():
    """Создаёт таблицу, если её ещё нет. Вызывается при старте сервера."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
