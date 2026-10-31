# H3 · Tickets board + mobile technician view (Harshavi · ~50 min)

**Read first:** `docs/AI_RULES.md`, `docs/contract/api.md` (Tickets & technicians).

## Goal
Show the full workforce loop: auto-ticket → assign → technician fixes on phone → system **verifies with data**.

## Build
1. **Tickets page** (`/tickets`): columns Open · Assigned · In progress · Done. Each card: title, entity, priority chip, `source` badge ("AUTO" for auto-created), **live SLA countdown** (`sla_seconds_left`, turns red when < 20%), "ESCALATED" badge, technician.
2. **Ticket detail drawer:** description + `evidence` (the alert explanation and a small chart if available), **Assign** dropdown that shows `/api/technicians/suggest` results first with their `reason`, status buttons.
3. **Verification badge:** `pending` → spinner "Verifying with live data…", `verified` → green "Fix verified ✓", `failed` → red "Still abnormal, reopened". This is a key demo moment, so make it satisfying (small animation).
4. **`/tech` mobile view** (design for phone width first): pick technician (no login needed for demo), list of their tickets, Start → In progress, **Complete** with photo (`<input type="file" accept="image/*" capture="environment">`) + note → `POST /api/tickets/{id}/complete`.
5. Create-ticket form (from asset card or manual) with priority.

## Decide with your human
How to open `/tech` on a phone during the demo (same Wi-Fi + laptop IP, e.g. `npm run dev -- --host`). Test this early.

## Done when
- [ ] Ticket moves through all statuses; SLA timer counts down
- [ ] `/tech` works on an actual phone on the same network

**Commit:** `frontend: tickets + technician view` · **Next:** H4
