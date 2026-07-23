"""
Скриншотер лендинга: поднимает приложение в изолированном браузере
с ВЫДУМАННЫМИ данными и снимает реальные экраны интерфейса.
Настоящие данные пользователя не затрагиваются — другой браузерный профиль.

Запуск:  python make_shots.py
"""
import json
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "landing" / "img"
OUT.mkdir(parents=True, exist_ok=True)

STORAGE_KEY = "ledgerBudgetApp_v16"
USD = 3.42
TODAY = date.today()


def d(days_ago: int) -> str:
    return (TODAY - timedelta(days=days_ago)).isoformat()


def tx(**kw):
    base = {"id": kw.pop("id"), "date": kw.pop("date"), "currency": "BYN", "rate": 1, "note": ""}
    base.update(kw)
    return base


# ---------- Демо-портфель (все цифры выдуманы) ----------
assets = [
    {"id": "c1", "name": "Наличные BYN", "class": "cash", "unit": "BYN"},
    {"id": "c2", "name": "Счёт USD", "class": "cash", "unit": "USD"},
    {"id": "a1", "name": "BTC", "class": "crypto"},
    {"id": "a2", "name": "ETH", "class": "crypto"},
    {"id": "a3", "name": "AAPL", "class": "stocks"},
    {"id": "a4", "name": "Золото", "class": "metals"},
]

market = {
    "a1": {"priceUSD": 61500.0, "lastUpdated": d(0) + "T09:00:00.000Z"},
    "a2": {"priceUSD": 3120.0, "lastUpdated": d(0) + "T09:00:00.000Z"},
    "a3": {"priceUSD": 224.0, "lastUpdated": d(0) + "T09:00:00.000Z"},
    "a4": {"priceUSD": 84.5, "lastUpdated": d(0) + "T09:00:00.000Z"},
}

transactions = []
n = 0


def add(**kw):
    global n
    n += 1
    transactions.append(tx(id=f"t{n}", **kw))


# зарплата и расходы за 8 месяцев
for m in range(8, 0, -1):
    day = d(m * 30)
    add(date=day, type="income", txType="income", category="Зарплата",
        amount=3800, assetId="c1", assetClass="cash", quantity=3800)
    add(date=d(m * 30 - 4), type="expense", txType="expense", category="Жильё",
        amount=950, assetId="c1", assetClass="cash", quantity=950)
    add(date=d(m * 30 - 9), type="expense", txType="expense", category="Еда",
        amount=680, assetId="c1", assetClass="cash", quantity=680)
    add(date=d(m * 30 - 14), type="expense", txType="expense", category="Транспорт",
        amount=210, assetId="c1", assetClass="cash", quantity=210)
    add(date=d(m * 30 - 18), type="expense", txType="expense", category="Развлечения",
        amount=260, assetId="c1", assetClass="cash", quantity=260)
    add(date=d(m * 30 - 22), type="expense", txType="expense", category="Покупки",
        amount=340, assetId="c1", assetClass="cash", quantity=340)

# валютный счёт
add(date=d(200), type="income", txType="transfer", category="Прочее",
    amount=6500, assetId="c2", assetClass="cash", quantity=1900, currency="USD", rate=3.38)

# покупки активов
add(date=d(210), type="income", txType="invest", category="Прочее",
    amount=6300, assetId="a1", assetClass="crypto", quantity=0.036, pricePerUnit=175000)
add(date=d(150), type="income", txType="invest", category="Прочее",
    amount=3400, assetId="a2", assetClass="crypto", quantity=0.34, pricePerUnit=10000)
add(date=d(120), type="income", txType="invest", category="Прочее",
    amount=5200, assetId="a3", assetClass="stocks", quantity=8, pricePerUnit=650)
add(date=d(90), type="income", txType="invest", category="Прочее",
    amount=4100, assetId="a4", assetClass="metals", quantity=15, pricePerUnit=273)

deposits = [
    {"id": "d1", "amount": 9000, "currency": "BYN", "rate": 13.8, "termMonths": 13,
     "startDate": d(120), "capitalization": True, "bank": "Безотзывный BYN", "closed": False},
    {"id": "d2", "amount": 2000, "currency": "USD", "rate": 3.2, "termMonths": 24,
     "startDate": d(60), "capitalization": False, "bank": "Валютный вклад", "closed": False},
]

# снимки для графика роста
snapshots = []
base = 24000
for i, m in enumerate(range(8, -1, -1)):
    snapshots.append({
        "id": f"s{i}",
        "date": d(m * 30),
        "totalBYN": round(base + i * 2650 + (i ** 1.7) * 210, 2),
        "byClass": {},
    })

goals = [
    {"id": "g1", "name": "Подушка безопасности", "targetBYN": 45000,
     "deadline": (TODAY + timedelta(days=300)).isoformat(), "note": "6 месяцев расходов"},
    {"id": "g2", "name": "Первый взнос", "targetBYN": 90000,
     "deadline": (TODAY + timedelta(days=800)).isoformat(), "note": ""},
]

demo_state = {
    "transactions": transactions,
    "assets": assets,
    "deposits": deposits,
    "snapshots": snapshots,
    "goals": goals,
    "rates": {"USD": USD, "EUR": 3.72, "RUB": 0.037},
    "categories": {
        "income": ["Зарплата", "Стипендия/аванс", "Подарок", "Возврат долга", "Проценты/доход", "Прочее"],
        "expense": ["Еда", "Транспорт", "Жильё", "Учёба", "Развлечения", "Покупки",
                    "Перевод в MoneyBox", "Долг (выдан)", "Прочее"],
    },
    "marketPrices": market,
    "log": [],
    "settings": {"expectedReturnPct": 5, "depositsPrincipalOnly": False},
    "schemaVersion": 17,
    "ui": {"view": "dashboard", "txFilter": {"type": "all", "category": "all", "q": ""}, "reportMonths": 6},
}

SHOTS = [
    ("dashboard", "dashboard.png"),
    ("portfolio", "portfolio.png"),
    ("reports", "reports.png"),
    ("forecast", "forecast.png"),
]


def main():
    # локальный сервер для приложения
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", "5599"],
        cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(2)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_context(
                viewport={"width": 1440, "height": 900},
                device_scale_factor=2,
            ).new_page()

            # кладём демо-данные ДО загрузки приложения
            page.add_init_script(
                f"localStorage.setItem({json.dumps(STORAGE_KEY)}, {json.dumps(json.dumps(demo_state))});"
            )

            page.goto("http://127.0.0.1:5599/index.html", wait_until="networkidle")
            page.wait_for_timeout(2500)

            for view, filename in SHOTS:
                page.evaluate(
                    "(v) => document.querySelector(`[data-go='${v}']`)?.click()", view
                )
                page.wait_for_timeout(2200)   # ждём анимации и графики
                page.screenshot(path=str(OUT / filename))
                print("saved", filename)

            browser.close()
    finally:
        server.terminate()


if __name__ == "__main__":
    main()
