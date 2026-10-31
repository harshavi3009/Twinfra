# Git guide (team workflow)

Four people and four AI assistants push to one repo. These rules keep `main` working and avoid conflicts.

## Rules
1. **Never push to `main`.** Work on a branch and open a Pull Request into `main`.
2. **One branch per task.** Name it `<owner>/<task>`, for example `harshavi/h4-insights-reports-import` or `ayaan/a3-tickets-technicians`.
3. **Stage only your own files.** Add paths explicitly. Never run `git add .` from the repo root.
4. **Commit small and often.** One working step per commit. Messages look like `frontend: tickets board, ticket drawer`.
5. **Never force-push.** If a push is rejected, fetch and merge `main` into your branch first.
6. **Check with the team before pushing shared files.** `contract/`, `docs/`, `backend/app/models.py` and `frontend/package.json` affect everyone.
7. **Secrets stay out of git.** Put database URLs and keys in `.env`, which is git-ignored. Commit only `.env.example` with placeholders.

## Folder ownership
| Folder | Owner |
|---|---|
| `frontend/` (except `src/campus3d/`), `docs/`, `.gitignore`, `CLAUDE.md` | Harshavi |
| `frontend/src/campus3d/` | Rishi |
| `backend/` (except `backend/app/insights/`) | Ayaan |
| `ml/`, `data/`, `backend/app/insights/` | Aditya |

Need a change in someone else's folder? Write the exact request and send it to the owner. Don't edit their files.

## Daily commands (PowerShell)
```powershell
# Start from the latest main
git checkout main
git pull origin main

# New task branch
git checkout -b harshavi/h5-my-task

# Work, then stage your own files only
git add frontend/src/pages/Tickets.jsx frontend/src/components/TicketCard.jsx
git commit -m "frontend: ticket card polish"

# Push the branch (not main)
git push -u origin harshavi/h5-my-task
```
Then open a PR on GitHub from that branch into `main`, and wait for a review before merging.

## Keeping your branch up to date
```powershell
git fetch origin
git merge origin/main
```
Resolve any conflicts in your own files. For a conflict in someone else's file, ask the owner.

## Pull requests
- Title: what changed, plus the task id, for example `frontend: tickets board, ticket drawer, technician view (H3)`.
- Body: a short summary, how to test it, and any known gaps.
- Keep each PR to one task so reviews stay quick.
