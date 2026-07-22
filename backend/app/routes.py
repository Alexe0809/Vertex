"""
Роуты (эндпоинты). APIRouter группирует их, main.py подключает одной строкой.
Каждый эндпоинт тонкий: вся логика — в services.py.
"""
from fastapi import APIRouter, HTTPException

from . import services
from .schemas import (
    RatesResponse, SummaryResponse, PortfolioResponse, HealthResponse,
)

router = APIRouter(prefix="/api", tags=["vertex"])


def _require_state() -> dict:
    """Общий помощник: достать состояние или вернуть понятную 404."""
    state = services.load_state()
    if state is None:
        raise HTTPException(
            status_code=404,
            detail="Нет данных. Выгрузите бэкап из Настроек в backend/data/state.json",
        )
    return state


@router.get("/health", response_model=HealthResponse)
def health():
    return {
        "service": "Vertex API",
        "status": "ok",
        "has_data": services.load_state() is not None,
    }


@router.get("/rates", response_model=RatesResponse)
async def get_rates():
    return await services.fetch_rates()


@router.get("/summary", response_model=SummaryResponse)
def get_summary():
    return services.compute_summary(_require_state())


@router.get("/portfolio", response_model=PortfolioResponse)
def get_portfolio():
    return services.compute_portfolio(_require_state())