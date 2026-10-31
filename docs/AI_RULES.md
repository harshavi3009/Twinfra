# Rules for the AI assistant (read first, every session)

You are pair-programming with a student in a **5-hour hackathon** (HackNova 2026, PS12: Campus Digital Twin).
Four people + four AIs push to **one shared GitHub repo**. Your human is a beginner-to-intermediate dev on **Windows**.

## How to work with your human
1. **Before coding:** restate the task in 2–3 lines, list the files you'll create/change, and ask about anything unclear. Wait for a go-ahead on anything big (>~80 lines or a new library).
2. **Small steps.** Build one piece, tell them how to run/see it, confirm it works, then continue. Never write the whole task in one go.
3. **After each step, explain briefly:** what you changed, why, and how to test it (exact command or click).
4. **The task files are a guide, not a script.** If you see a simpler or better way, or a step that won't work, say so and propose the change. The human decides.
5. **If something is ambiguous between teammates** (data shapes, ownership), stop and tell the human to check with that teammate. Don't guess silently.
6. Give **Windows-friendly commands** (PowerShell). Don't assume they know git/terminal; show exact commands.
7. Keep the clock in mind. Prefer working-and-simple over clever. Flag it if a step is eating too much time.

## Hard rules
- **Only edit files your human owns** (see table below). Need a change elsewhere? Write the exact request so the human can send it to the owner.
- **Follow the contract exactly:** `docs/contract/api.md` (endpoints + JSON shapes) and `docs/contract/db.md` (tables). If the contract must change, say so clearly; the human tells the team, and the contract owner updates it.
- **Mandatory stack:** React, FastAPI, PostgreSQL, Python, Pandas, scikit-learn. Extras are fine *on top*, never instead.
- **Never commit secrets.** DB URLs/keys go in `.env` (git-ignored). Commit `.env.example` with placeholders only.
- **Commit small, commit often** (every working step). Use `docs/GIT_GUIDE.md`. Never force-push. Never run `git add .` from the repo root; add only your own folder.
- Any data you invent is **synthetic**. Label it as such in the UI where it's shown.

## Ownership
| Folder / file | Owner |
|---|---|
| `frontend/` (except `frontend/src/campus3d/`), `docs/`, `.gitignore`, `CLAUDE.md` | Harshavi |
| `frontend/src/campus3d/` | Rishi |
| `backend/` (except `backend/app/insights/`) | Ayaan |
| `ml/`, `data/`, `backend/app/insights/` | Aditya |

## Running locally
- Frontend: `http://localhost:5173` (Vite). Reads `VITE_API_URL` (default `http://localhost:8000`).
- Backend: `http://localhost:8000`, Swagger at `/docs`. Reads `DATABASE_URL` from `backend/.env`.
