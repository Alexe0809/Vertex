"""Настройки приложения. Всё, что может меняться между машинами/окружениями — здесь."""
from pathlib import Path

# Корень backend/ (на уровень выше app/)
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"

# Откуда фронтенд имеет право обращаться к API (CORS)
ALLOWED_ORIGINS = [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
]

# Внешний источник курсов валют (тот же, что использует фронтенд)
CURRENCY_API_URL = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/byn.json"
WANTED_CURRENCIES = ["USD", "EUR", "RUB"]

# Таймаут внешних запросов, секунды
HTTP_TIMEOUT = 8.0

# Файл с выгруженным состоянием приложения (бэкап из Настроек кладётся сюда)
STATE_FILE = DATA_DIR / "state.json"