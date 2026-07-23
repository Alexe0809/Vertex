---
title: Vertex API
emoji: 📊
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# Vertex

Личное приложение учёта финансов: фронтенд на ванильном JS + бэкенд на FastAPI.

## Структура

```
├── index.html, app.js, style.css   — фронтенд (деплой на Netlify)
├── src/                            — модули фронтенда
│   ├── core/                       — расчёты (портфель, депозиты, курсы)
│   └── ui/                         — интерфейс (views, shell, dom)
├── backend/                        — API на FastAPI
│   └── app/                        — config, services, routes, schemas, database
├── v2/                             — песочница Vite + React + TypeScript
└── Dockerfile                      — сборка бэкенда для Hugging Face Spaces
```

## Бэкенд (этот Space)

FastAPI + PostgreSQL (Neon). Эндпоинты:

- `GET /api/health` — статус сервиса
- `GET /api/rates` — курсы валют к BYN
- `GET /api/state` — состояние приложения (нужен токен)
- `PUT /api/state` — сохранить состояние (нужен токен)
- `GET /api/summary` — сводка по капиталу
- `GET /api/portfolio` — разбивка портфеля по классам

Документация: `/docs`

## Локальный запуск

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Секреты — в `backend/.env` (`DATABASE_URL`, `API_TOKEN`), в репозиторий не попадают.
