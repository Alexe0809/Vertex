"""
Схемы ответов (Pydantic-модели).
Аналог TypeScript-типов из v2: единый контракт формы данных.
FastAPI по ним автоматически валидирует ответы и строит документацию.
"""
from pydantic import BaseModel


class RatesResponse(BaseModel):
    base: str
    rates: dict[str, float]
    date: str | None = None


class SummaryResponse(BaseModel):
    total_byn: float
    total_usd: float
    assets_count: int
    deposits_count: int
    transactions_count: int


class ClassBreakdown(BaseModel):
    asset_class: str
    total_byn: float
    percent: float


class PortfolioResponse(BaseModel):
    total_byn: float
    by_class: list[ClassBreakdown]


class HealthResponse(BaseModel):
    service: str
    status: str
    has_data: bool