# My work on Twinfra (CampusTwin) — plain-English notes

Last updated: after D3.

## Who I am in this project

HackNova 2026, problem statement 12: **Campus Digital Twin**.
Four people, four AIs, one shared repo (`harshavi3009/Twinfra`).

| Person | Owns |
|---|---|
| Harshavi | `frontend/` (except the 3D folder), `docs/` |
| Rishi | `frontend/src/campus3d/` |
| Ayaan | `backend/` (except the insights folder) |
| **Me (Aditya)** | **`ml/`, `data/`, `backend/app/insights/`** |

My rule: I only edit those three places. If I need something from someone
else's code, I ask them instead of editing it.

My branch: `aditya-dev`. I push there, open a PR, and someone merges into
`main`. I never push to `main` — a git hook blocks it.

---

## The one-line pitch

A 3D model of the campus that notices when things are wasting power or about to
break, explains why in plain language, raises a repair ticket automatically,
and proves the repair worked when the numbers go back to normal.

My job is the "brain": everything that decides **this is wrong, here is why,
here is what it costs, here is what to do.**

---

## The three folders I own

### 1. `data/` — the fake campus

There is no real college feeding us sensor data, so I invent a believable one.
All of it is **synthetic** and we say so on screen and in the PPT.

`data/` holds 8 CSV files, one per database table:

| File | What's in it | Think of it as |
|---|---|---|
| `buildings.csv` | 6 buildings, floor counts, map position, opening hours | the campus map |
| `floors.csv` | 15 floors | the levels inside each building |
| `rooms.csv` | 108 rooms with a type (classroom, lab, hostel room…) and capacity | the rooms |
| `equipment.csv` | 328 devices: ACs, lights, computers, lifts, a transformer… with rated power, owner, install date, warranty, how critical it is, replacement cost | the asset register an estate office keeps |
| `connections.csv` | who feeds power/water to whom (substation → building → floor → device) | the wiring diagram |
| `technicians.csv` | 8 maintenance staff with skills (electrical, hvac, plumbing…) | the maintenance team |
| `maintenance_log.csv` | a year of past repairs and services with costs | the repair history |
| `readings.csv` | 14 days of hourly sensor data: power in kW, water in litres/min, people count | the meter readings |

### 2. `ml/` — the generator and the simulator

**`ml/config.py`** — every tunable number in one place: ₹9 per kWh, 0.71 kg CO₂
per kWh, seed, how many rooms of each kind, the campus layout. Judges always
ask "why this number", so keeping them in one file means I can point at it.

**`ml/generate_data.py`** — builds the whole campus from scratch with a fixed
random seed (so everyone gets the identical campus). The readings are not pure
noise; they follow how a real campus behaves:

- classrooms and offices are busy 9–17, nearly empty at night, dead on Sunday
- AC load rises with afternoon heat
- labs only draw heavy power when a class is timetabled
- hostels are the opposite — busy at night, quiet in the day
- building totals are the **sum of their rooms**, so the dashboard never
  contradicts itself between panels

Then it deliberately plants four stories the ML is supposed to "discover":

1. **Ghost load** — a lab in B2 runs ~4.2 kW of ACs and lights at 00:00–05:00
   with zero people inside. Real waste that nobody notices.
2. **Night leak** — the hostel draws ~5.4 litres/min of water at 02:00–04:00.
   A pipe leaking in the dark.
3. **Drifting transformer** — its load creeps up ~6% over two weeks. Ageing
   equipment.
4. **A bad AC** — 3 repairs in 6 months, warranty expiring in 2 weeks. Should be
   replaced, not repaired again.

Those four are why the demo looks real instead of showing random red dots.

**`ml/simulator.py`** — makes the campus feel alive during the demo. Every 3
seconds it generates the current hour's readings for every room and device,
applies whatever faults we've injected, and pushes them to the backend. Every
3rd tick it asks the backend to run detection.

Flags: `--speed 5` (5 simulated hours per tick so a day passes in a minute),
`--once`, `--dry-run`, `--run-every`, `--tick`, `--seed`.

### 3. `backend/app/insights/` — the API I own

| File | Job |
|---|---|
| `faults.py` | the list of currently injected demo faults, kept in memory |
| `router.py` | the `/api/insights/*` endpoints |
| `common.py` | shared maths: what "normal" looks like, the wiring tree, ₹ and CO₂ conversions |
| `detect.py` | the four anomaly detectors |
| `predict.py` | the RandomForest that scores failure risk |
| `tickets.py` | turns a serious alert into a repair ticket |
| `verify.py` | proves a repair actually worked |
| `reporting.py` | `run_all()` (runs everything each tick) + the D4 reports |

---

## What is built and working

### D1 — synthetic data (done)

`ml/generate_data.py` writes all 8 CSVs. Everything is reproducible from a seed.
Prints a summary of row counts and the four planted stories.

### D2 — live simulator + fault injection (done)

The point of D2 is **the demo can be triggered on cue**. If judges want to see
the system catch a problem, you don't wait for one — you press a button.

How a fault injection works:

1. Someone calls `POST /api/insights/sim/fault` with
   `{"entity_id": "B1-F2-R01", "kind": "spike"}`.
2. `faults.py` remembers it.
3. On its next tick the simulator asks `GET /api/insights/sim/faults`, sees the
   fault, and bends its own numbers: that room now draws 2.5× its normal power,
   **and so does its floor and its building** — because that's how electricity
   actually works, a room can't spike without its building meter noticing.
4. Within a few seconds the room turns red on the screen.

Three fault kinds:

| Kind | What the simulator does | Why it's realistic |
|---|---|---|
| `spike` | draws 2–3× normal power on the entity and every parent | a failing motor or a short |
| `ghost_load` | adds ~4.2 kW and forces occupancy to 0 | equipment left running in an empty room overnight |
| `night_leak` | adds ~5.4 lpm water regardless of occupancy | a leaking pipe |

When a technician completes the repair, Ayaan's endpoint calls my
`clear_fault(entity_id)`, the fault is dropped, the simulator stops replaying
it, and the readings fall back to normal. That falling-back is what D3's
verification step watches for.

`DELETE /api/insights/sim/faults` clears everything, for a clean demo reset.

---

## The numbers I use, and why

| Constant | Value | Reason |
|---|---|---|
| Tariff | ₹9 / kWh | typical Indian institutional rate (assumed) |
| Grid emissions | 0.71 kg CO₂ / kWh | CEA grid factor (assumed — check latest before the PPT) |
| Tree absorption | 21 kg CO₂ / tree / year | standard citation used for "equivalent to N trees" |
| Reading interval | 1 hour | keeps 14 days of data to a download-able size |
| History | 14 days | enough to learn weekday+hour patterns |

Every one of these is labelled **assumed** wherever the UI shows it.

---

## How the pieces talk to each other

```
ml/generate_data.py  ──writes──►  data/*.csv
                                      │
                                      ▼
                              Ayaan's seed.py
                                      │
                                      ▼
                                 PostgreSQL
                                      │
        ┌─────────────────────────────┼──────────────────────────┐
        │                             │                          │
   ml/simulator.py             my insights/               Ayaan's routers
   (every 3 s)                 (alerts, ML)               (/api/campus etc.)
        │                             │                          │
        └──────────►  POST /api/readings ◄─── reads readings ─────┘
                                      │
                                      ▼
                              Harshavi's React UI
```

The important line: **the simulator writes, the detectors read.** They never
call each other directly, so I can change one without breaking the other.

---

## What is next

**D3 — detection, prediction, verification.** The actual intelligence:

1. **Baselines** — for each device and metric, what is normal *for this weekday
   at this hour*. A lab's 2 pm Tuesday load is not the same as its 3 am Sunday
   load, so a single average would flag everything.
2. **Spike detection** — value above baseline + 3σ, or 1.8× the baseline.
3. **IsolationForest** (scikit-learn) — looks at power, occupancy, hour and
   weekday *together* to catch odd combinations a threshold misses.
4. **Ghost load & night leak** — high power with nobody there; water flowing
   while the building is closed.
5. **Cost estimate** — extra kW × ₹9 × hours/month.
6. **Auto-ticket** — serious alerts raise a repair ticket with the alert as
   evidence, so a technician gets it without a human triaging.
7. **Failure prediction** — RandomForest on age, load ratio, recent anomalies,
   past failures and time since service → a risk score and "days to failure",
   with the top reasons in plain words ("3 anomalies this week", "high runtime").
8. **Fix verification** — when a ticket is completed, watch the readings for
   30 s. Back to normal → `verified`. Still broken after 2 min → `failed`, and
   the ticket reopens. **This is the feature that makes the demo land** — the
   system proves its own work.

### D3 — detection, tickets, prediction, verification (done)

**How detection works.** Every tick, "normal" is recomputed as the average for
*that weekday at that hour* — a lab's 2 pm Tuesday load is nothing like its
3 am Sunday load, so a single campus average would either miss everything or
flag everything. Four detectors then compare the latest readings to that
normal:

| Detector | Rule | Why |
|---|---|---|
| `spike` | above normal + 3σ, or 1.8× normal | catches a failing motor or a short |
| `ghost_load` | power drawn overnight with nobody in the room | equipment left running, invisible on a normal dashboard |
| `night_leak` | water flowing overnight with nobody there | a leaking pipe |
| `drift` | this week's average ≥15% above last week's | equipment ageing before it breaks |

All four successfully find the stories planted back in D1 — the ghost load in
`B2-F1-R01`, the leak in `B5`, and the drifting transformer `EQ-0328`.

**Auto-tickets.** A `critical` or `high` alert raises a repair ticket on its
own, with the alert attached as evidence (what was measured, what was expected,
the ratio, the ₹/month). The ticket carries an SLA deadline by severity — 4 hours
for critical, 24 for high. One open ticket per thing, so a persistent fault does
not spawn a new ticket every tick. Tickets land in the reserved `TK-9xxx` range
and switch to Ayaan's real sequence automatically once he ships it.

The technician is deliberately left unassigned: the system suggests the right
person, a human clicks assign. A demo where the dispatcher decides reads better
than invisible automation.

**Failure prediction.** A RandomForest looks at age, days since last service,
repairs in the last 6 months, anomalies this week, current load vs rated load,
warranty left, and how critical the asset is. It produces a 0–1 risk, an
estimated days-to-failure, and the two or three strongest reasons in plain
words ("3 anomalies in the last 7 days", "Drawing 140% of its rated load").

The model is trained on synthetic-but-plausible labels, because a two-week-old
campus has no real failure history. That is stated openly. The raw probability
came out too compressed to read (everything near 0.7), so the final risk blends
it with the asset's percentile rank on campus — the ordering is the model's, the
number now spreads across 0–1 and means "how bad is this relative to everything
else here".

**Fix verification — the feature that makes the demo land.** When a technician
marks a ticket done, the system does not believe them:

1. wait 30 seconds for the fix to show up in the meter
2. watch for up to 2 minutes
3. readings back within 1.5× of normal → `verified`
4. still out of band → `failed`, and the ticket **reopens by itself**

So the demo can say "the repair worked" with evidence, and can also say "the
repair did not work, here is the ticket that reopened". Tested and confirmed the
`failed` path fires correctly.

### D4 — reports (done, part of the same commit)

- **Interventions** — every active alert turned into a proposal with a ₹/month
  saving and a payback period, plus one campus-wide LED retrofit project. Sorted
  by saving, so "do this first" is answered directly.
- **What-if** — `POST /api/insights/whatif` with `led_retrofit`, `schedule_ac`,
  `fix_ghost_load` or `solar_roof`. Returns baseline vs projected kWh, ₹ and
  CO₂, plus a per-building breakdown the 3D map can use to recolour.
- **Sustainability report** — kWh, water, CO₂, ₹, tree-equivalent, a 0–100
  score, and a per-building split.
- **Asset health** — a health score per building plus the 20 riskiest assets.

**D4 originally** — intervention ranking (what to spend money on first, with payback in
months), the what-if simulator (LED retrofit → ₹/month and CO₂ saved, buildings
recolour on the 3D map), and the sustainability + asset-health reports.

---

## How I verified all this without a working local server

`ml/test_insights.py` builds a throwaway SQLite database, loads the real
`data/*.csv` into it, and runs the entire pipeline — detection, tickets,
predictions, verification, reports. Postgres-only types are swapped for SQLite
equivalents at runtime, so `models.py` is never touched. That means the logic is
testable in one command, with no server and no database to set up:

    .venv/bin/python ml/test_insights.py

On top of that, D3 has now been run end-to-end against the shared Supabase
Postgres — all 11 tables, 190,405 readings — and every `/api/insights/*` route
returns its contract shape. So there are no remaining unknowns about whether it
works against the real database.

## Known blockers

- **`ticket_id_seq`** — my auto-tickets use the reserved `TK-9xxx` range until
  Ayaan lands his atomic sequence in A3. The switch-over is automatic.
- **Readings upsert** — my simulator replays the current hour every tick.
  Ayaan's `/api/readings` will upsert on `(entity_id, metric, ts)` once he adds
  the unique constraint; until then the simulator dedupes on its side.
- **Fix verification has no trigger yet** — Ayaan's ticket-complete endpoint
  needs to call `insights.verify.verify_ticket(db, id)` (or just let the next
  `run_all()` tick pick it up — `verify_pending()` already scans every completed
  ticket, so this works without any wiring from him).

---

## Practical notes

- Run the generator: `.venv/bin/python ml/generate_data.py`
- Run the simulator: `.venv/bin/python ml/simulator.py` (add `--dry-run` to
  check it without sending anything)
- Push: `git add ml/ backend/app/insights/` — **never `git add .`**, that would
  sweep up other people's work
- The `readings.csv` is 8.8 MB and committed. It is regenerable, so if it ever
  causes pain we gitignore it and everyone re-runs the generator.
