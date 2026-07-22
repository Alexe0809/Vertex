"""
Сервисный слой: логика и работа с данными.
Роутеры (endpoints) остаются тонкими — только принять запрос и вызвать сервис.
Это тот же принцип, что "core/ отдельно от ui/" во фронтенде.
"""
import json
import httpx

from . import config


# ---------- Работа с состоянием приложения ----------

def load_state() -> dict | None:
    """Читает выгруженный бэкап (data/state.json). Нет файла -> None."""
    if not config.STATE_FILE.exists():
        return None
    try:
        with open(config.STATE_FILE, encoding="utf-8-sig") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _rate_for(state: dict, currency: str) -> float:
    if currency == "BYN":
        return 1.0
    return float(state.get("rates", {}).get(currency, 1) or 1)


def _asset_value_byn(asset: dict) -> float:
    return float(asset.get("quantity", 0) or 0) * float(asset.get("priceBYN", 0) or 0)


# ---------- Вычисления по портфелю ----------

def compute_summary(state: dict) -> dict:
    assets = state.get("assets", [])
    deposits = state.get("deposits", [])
    txs = state.get("transactions", [])

    total_assets = sum(_asset_value_byn(a) for a in assets)
    total_deposits = sum(float(d.get("amount", 0) or 0) for d in deposits)
    total = total_assets + total_deposits

    usd_rate = _rate_for(state, "USD")
    return {
        "total_byn": round(total, 2),
        "total_usd": round(total / usd_rate, 2) if usd_rate else 0.0,
        "assets_count": len(assets),
        "deposits_count": len(deposits),
        "transactions_count": len(txs),
    }


def compute_portfolio(state: dict) -> dict:
    assets = state.get("assets", [])
    by_class: dict[str, float] = {}
    for a in assets:
        cls = a.get("class", "other")
        by_class[cls] = by_class.get(cls, 0.0) + _asset_value_byn(a)

    for d in state.get("deposits", []):
        by_class["deposit"] = by_class.get("deposit", 0.0) + float(d.get("amount", 0) or 0)

    total = sum(by_class.values()) or 1.0
    breakdown = [
        {
            "asset_class": cls,
            "total_byn": round(val, 2),
            "percent": round(val / total * 100, 1),
        }
        for cls, val in sorted(by_class.items(), key=lambda kv: -kv[1])
    ]
    return {"total_byn": round(sum(by_class.values()), 2), "by_class": breakdown}


# ---------- Внешние данные: курсы ----------

async def fetch_rates() -> dict:
    async with httpx.AsyncClient(timeout=config.HTTP_TIMEOUT) as client:
        resp = await client.get(config.CURRENCY_API_URL)
        resp.raise_for_status()
        data = resp.json()

    byn = data.get("byn", {})
    rates = {}
    for cur in config.WANTED_CURRENCIES:
        per_byn = byn.get(cur.lower())
        if per_byn:
            rates[cur] = round(1 / per_byn, 4)
    return {"base": "BYN", "rates": rates, "date": data.get("date")}
# ---------- Хранение состояния в БД (Neon PostgreSQL) ----------
import json as _json
from sqlalchemy import select
from .database import SessionLocal, AppState


async def db_load_state() -> dict | None:
    """Читает состояние приложения из БД (строка id='main')."""
    async with SessionLocal() as session:
        row = await session.get(AppState, "main")
        if row is None:
            return None
        try:
            return _json.loads(row.data)
        except (ValueError, TypeError):
            return None


async def db_save_state(state: dict) -> None:
    """Сохраняет состояние приложения в БД (перезаписывает строку id='main')."""
    payload = _json.dumps(state, ensure_ascii=False)
    async with SessionLocal() as session:
        row = await session.get(AppState, "main")
        if row is None:
            session.add(AppState(id="main", data=payload))
        else:
            row.data = payload
        await session.commit()
