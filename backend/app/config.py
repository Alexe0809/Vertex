"""Настройки приложения. Всё, что может меняться между машинами/окружениями — здесь."""
import os
from pathlib import Path

# Корень backend/ (на уровень выше app/)
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"

# Откуда фронтенд имеет право обращаться к API (CORS).
# Локальная разработка + задеплоенный фронтенд на Netlify.
ALLOWED_ORIGINS = [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "https://guileless-malabi-6114a2.netlify.app",
]

# Дополнительные origin можно добавить через переменную окружения (через запятую),
# не трогая код — удобно, если сменится домен Netlify.
_extra = os.getenv("EXTRA_ORIGINS", "")
if _extra:
    ALLOWED_ORIGINS += [o.strip() for o in _extra.split(",") if o.strip()]

# Внешний источник курсов валют (тот же, что использует фронтенд)
CURRENCY_API_URL = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/byn.json"
WANTED_CURRENCIES = ["USD", "EUR", "RUB"]

# Таймаут внешних запросов, секунды
HTTP_TIMEOUT = 8.0

# Файл с выгруженным состоянием приложения (legacy, используется как запасной источник)
STATE_FILE = DATA_DIR / "state.json"
