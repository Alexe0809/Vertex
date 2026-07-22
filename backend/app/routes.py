"""
Роуты (эндпоинты). Тонкие: принять запрос -> проверить токен -> вызвать сервис.
"""
from fastapi import APIRouter, HTTPException, Header, Body

from . import services
from .database import API_TOKEN
from .schemas import (
    RatesResponse, SummaryResponse, PortfolioResponse, HealthResponse,
)

router = APIRouter(prefix="/api", tags=["vertex"])


def _check_token(authorization: str | None):
    """Простая авторизация: заголовок Authorization должен совпасть с API_TOKEN из .env."""
    if not API_TOKEN:
        return  # токен не задан — защита выключена (только для локальной разработки)
    expected = f"Bearer {API_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Неверный или отсутствующий токен доступа")


@router.get("/health", response_model=HealthResponse)
async def health():
    state = await services.db_load_state()
    return {"service": "Vertex API", "status": "ok", "has_data": state is not None}


@router.get("/rates", response_model=RatesResponse)
async def get_rates():
    return await services.fetch_rates()


# ---------- Состояние приложения (защищено токеном) ----------

@router.get("/state")
async def get_state(authorization: str | None = Header(default=None)):
    _check_token(authorization)
    state = await services.db_load_state()
    if state is None:
        return {}  # ещё нет данных — фронтенд стартует с пустого состояния
    return state


@router.put("/state")
async def put_state(
    state: dict = Body(...),
    authorization: str | None = Header(default=None),
):
    _check_token(authorization)
    await services.db_save_state(state)
    return {"status": "saved"}


# ---------- Аналитика (тоже из БД) ----------

async def _require_state() -> dict:
    state = await services.db_load_state()
    if state is None:
        raise HTTPException(status_code=404, detail="Нет данных в базе")
    return state


@router.get("/summary", response_model=SummaryResponse)
async def get_summary():
    return services.compute_summary(await _require_state())


@router.get("/portfolio", response_model=PortfolioResponse)
async def get_portfolio():
    return services.compute_portfolio(await _require_state())
