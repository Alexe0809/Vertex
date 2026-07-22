"""
Vertex API — бэкенд для приложения личных финансов.
Первый эндпоинт: GET /api/rates — курсы валют к BYN.
Данные берём с currency-api, но уже НА СЕРВЕРЕ: ключей нет, CORS не мешает.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import httpx

app = FastAPI(title="Vertex API")

# Разрешаем фронтенду (Live Server на 5500) обращаться к нам.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500", "http://localhost:5500"],
    allow_methods=["*"],
    allow_headers=["*"],
)

CURRENCY_API = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/byn.json"
WANTED = ["USD", "EUR", "RUB"]


@app.get("/")
def root():
    return {"service": "Vertex API", "status": "ok"}


@app.get("/api/rates")
async def get_rates():
    async with httpx.AsyncClient(timeout=8.0) as client:
        resp = await client.get(CURRENCY_API)
        resp.raise_for_status()
        data = resp.json()

    byn = data.get("byn", {})
    rates = {}
    for cur in WANTED:
        per_byn = byn.get(cur.lower())
        if per_byn:
            rates[cur] = round(1 / per_byn, 4)  # "X за 1 BYN" -> "BYN за 1 X"

    return {"base": "BYN", "rates": rates, "date": data.get("date")}