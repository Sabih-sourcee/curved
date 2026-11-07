# Curved

Multi-bot desktop agents with **local computer control** — Grok Bot–style teammate bots, Clicky-style screenshot → click → type on *your* Windows PC.

## Features

- Multiple named bots with roles and separate chats
- **One on-screen cursor per bot** (Clicky-style floating pointer, colored by bot)
- Run several bots at once — each cursor flies to its own targets
- Real mouse/keyboard actions are queued so cursors don't collide
- Chat mode for normal conversation
- `/agent` mode: vision model sees your screen and drives that bot's cursor
- Per-action approval (or auto-approve)
- Live screen preview while agents work
- OpenAI-compatible API (OpenRouter / OpenAI / etc.)

## Setup

```bash
npm install
npm run dev
```

Open **Settings** and paste a **Google AI Studio** API key (`AIza…`).
Defaults are already set for Gemini:

- Base URL: `https://generativelanguage.googleapis.com/v1beta/openai`
- Model: `gemini-3.1-flash-lite`

You can also put the key in `.env` as `GEMINI_API_KEY=...` (restart the app after).

## Usage

1. Pick or create a bot in the sidebar.
2. Chat normally, or send `/agent open Notepad and type hello`.
3. Approve each computer action (unless auto-approve is on).

## Notes

- Only one bot can control the PC at a time.
- Computer use moves the real mouse/keyboard on this machine.
- Keep sensitive windows closed while an agent runs.
