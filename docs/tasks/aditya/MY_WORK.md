# My part — Aditya (Twinfra / Campus Digital Twin)

HackNova 2026, PS12. Everything below is what **I** own per `AI_RULES.md`:
`ml/`, `data/`, `backend/app/insights/`. Nothing else — if another folder needed
a change, I asked the owner instead of editing it.

---

## 1. What the system does, in one paragraph

A 3D model of the campus that notices when something is wasting power or about
to break, explains why **in plain English**, raises a repair ticket on its own,
and then **proves the repair worked** by watching the meter afterwards.

My job is the brain behind that. The other three build the body:
Harshavi the screens, Rishi the 3D, Ayaan the database and API.

---

## 2. What I built, in the order I built it

### D1 — The fake campus (`data/`, `ml/generate_data.py`)

There is no real college feeding us sensors, so I invent a believable one. All
of it is **synthetic** and we say so on the disclosure slide.

`python ml/generate_data.py` writes 8 CSV files — one per database table:

| File | What's in it | Size |
|---|---|---|
| `buildings.csv` | 6 buildings, opening hours, map position | 6 |
| `floors.csv` | 15 floors | 15 |
| `rooms.csv` | 109 rooms typed as classroom / lab / office / hostel room / utility room | 109 |
| `equipment.csv` | 328 devices: ACs, lights, computers, lifts, a transformer — with rated power, install date, warranty, criticality, replacement cost | 328 |
| `connections.csv` | the wiring tree: substation → building → floor → device | 355 |
| `technicians.csv` | 8 staff with skills | 8 |
| `maintenance_log.csv` | a year of past repairs and services | 819 |
| `readings.csv` | 14 days of hourly power, water and occupancy readings | 190,405 |

**The readings are not random noise.** They follow how a campus actually
behaves, and that is what makes the ML look smart:

- classrooms and offices are busy 9–17, empty at night, dead on Sunday
- AC load rises with afternoon heat
- labs only pull heavy power when a class is timetabled
- hostels are the opposite — busy at night, quiet in the day
- a building's total is the **sum of its rooms**, so two panels on screen can
  never contradict each other

**Four stories are deliberately planted** so the ML has something real to find:

| Story | Where | What it looks like |
|---|---|---|
| Ghost load | `B2-F1-R01` (Lab 101) | 4.2 kW drawn 00:00–05:00 with **zero people** inside |
| Night leak | `B5` (Hostel) | 5.4 l/min of water flowing 02:00–04:00 |
| Drifting transformer | `EQ-0328` | load creeps up 6% across two weeks |
| Bad AC | `EQ-0001` | 3 repairs in 6 months, warranty ends in 2 weeks |

Everything is seeded (`SEED=42`), so every teammate gets the identical campus.

**One bug I found and fixed later:** the substation transformer had no room, but
`equipment.room_id` is `NOT NULL`. I gave it a utility room in B3 (rooms 108 →
109). Worth knowing because the 3D map gains one room.

---

### D2 — The live simulator and fault injection (`ml/simulator.py`, `insights/faults.py`)

The point of D2: **the demo can be triggered on cue.** Judges ask "show me it
catching something" and you do not wait — you press a button.

Every 3 seconds the simulator:

1. generates the current hour's readings for every room and device
2. asks `GET /api/insights/sim/faults` what faults are injected
3. bends its own numbers to match
4. pushes the readings to `POST /api/readings`
5. every third tick, calls `POST /api/insights/run` to run detection

Three fault kinds:

| Kind | What it does | Why it's realistic |
|---|---|---|
| `spike` | 2.5× normal power on the entity **and every parent** | a room cannot spike without its building's meter noticing |
| `ghost_load` | +4.2 kW, forces occupancy to 0 | equipment left running in an empty room |
| `night_leak` | +5.4 l/min of water | a pipe leaking in the dark |

When a technician completes the repair, the fault is cleared, the simulator
stops replaying it, and readings fall back to normal. **That falling back is
what D3's verification watches.**

Flags: `--speed` (simulated hours per tick), `--once`, `--dry-run`,
`--run-every`, `--tick`, `--seed`.

---

### D3 — Detection, tickets, prediction, verification

This is the actual intelligence. Files:

| File | Job |
|---|---|
| `detect.py` | finds the problems |
| `tickets.py` | raises repair tickets automatically |
| `predict.py` | predicts which asset is about to fail |
| `verify.py` | proves a repair actually worked |
| `reporting.py` | runs it all, plus the reports |
| `common.py` | shared maths: baselines, wiring tree, ₹/CO₂ conversions |

#### How detection works — the key idea

"Normal" is computed **per weekday per hour**. A lab's Tuesday-2pm load is
nothing like its Sunday-3am load. One campus-wide average would either miss
everything or flag everything. So for each room and device I build a table of
"what is normal for this entity, on this weekday, at this hour" from 14 days of
history, then compare the latest reading against it.

Four detectors (thresholds live in one `THRESHOLDS` dict so I can point at them):

| Detector | Rule | Catches |
|---|---|---|
| `spike` | above normal + 3σ **or** above 1.8× normal | failing motor, short circuit |
| `ghost_load` | power drawn overnight with **zero occupancy** | equipment left on in an empty room — invisible on a normal dashboard |
| `night_leak` | water flowing overnight with nobody there | leaking pipe |
| `drift` | this week's average ≥ 15% above last week's | equipment ageing before it breaks |

**All four planted stories get found**, plus the leak is correctly attributed to
`B5` itself and to three of its rooms.

Every alert carries: what was measured, what was expected, the ratio, a severity,
**a written explanation**, and **₹/month being wasted**.

> Room 101 is drawing 5.3 kW at 00:00 while the building is closed. ₹5,743/month.

#### Auto-tickets

A `critical` or `high` alert raises a repair ticket **on its own**, with the alert
attached as evidence. No human triages it.

- one open ticket per entity, so a lasting fault doesn't spawn 500 tickets
- SLA deadline by severity: 4h critical, 12h high, 48h medium, 72h low
- **the technician is deliberately left unassigned** — the system suggests the
  right person, a human clicks *assign*. A demo where the dispatcher decides
  reads better than invisible automation.
- tickets use a reserved `TK-9xxx` range so auto and manual are distinguishable,
  and switch to Ayaan's real database sequence automatically once it exists

#### Failure prediction

A RandomForest (scikit-learn) looks at 7 things:

| Feature | Why it matters |
|---|---|
| age_days | old things break |
| days_since_service | neglected things break |
| failures_180d | a repeat offender will reoffend |
| anomalies_7d | this week's warnings |
| load_ratio | running at 119% of rated load wears it out |
| warranty_days_left | old + unsupported |
| criticality | how much it matters if it dies |

Output: a risk score 0–1, an estimated **days to failure**, and the 2–3
strongest reasons **in words a technician would use**:

> EQ-0328 · risk 0.80 · fails in ~12 days
> "Drawing 119% of its rated load", "29 years old"

Two honest caveats I state openly:
- the model is trained on **synthetic-but-plausible labels**, because a 2-week-old
  campus has no real failure history to learn from
- the raw probability came out too compressed to read (everything near 0.7), so
  the final risk blends it with the asset's **percentile rank on campus**. The
  ordering is the model's; the number now spreads across 0–1 and means "how bad
  is this relative to everything else here". Cross-validated AUC ≈ 0.86.

#### Fix verification — the feature that makes the demo land

When a technician marks a ticket done, **the system does not believe them**:

1. wait 30 seconds for the fix to reach the meter
2. watch for up to 2 minutes
3. readings back within 1.5× of normal → **`verified`**
4. still out of band → **`failed`, and the ticket reopens by itself**

So the demo can say "the repair worked — here is the proof", and can also say
"the repair did not work, here is the ticket that reopened". I tested both paths;
the `failed` path fires correctly at 2.79× baseline.

---

### D4 — Interventions and reports (`reporting.py`)

**Interventions** — every active alert turned into a proposal with a ₹/month
saving, a capex, and a **payback period**, plus one campus-wide LED retrofit
project. Sorted by saving, so "what do we do first?" is answered directly.

> LED retrofit across campus lighting — saves ₹76,273/month, pays back in 3.1 months

**What-if** — `POST /api/insights/whatif` with `led_retrofit`, `schedule_ac`,
`fix_ghost_load` or `solar_roof`. Returns baseline vs projected kWh, ₹ and CO₂,
plus a per-building breakdown the 3D map uses to recolour buildings. Multiple
actions **compound** rather than add, so four at once gives 96% and never
negative.

**Sustainability report** — kWh, water, CO₂, ₹, tree-equivalent, a 0–100 score,
and a per-building split.

**Asset health** — an A–F grade per building plus the 20 riskiest assets.

---

## 3. The numbers I use, and why

| Constant | Value | Reason |
|---|---|---|
| Tariff | ₹9 / kWh | typical Indian institutional rate (**assumed**) |
| Grid emissions | 0.71 kg CO₂ / kWh | CEA grid factor (**assumed** — verify before the PPT) |
| Tree absorption | 21 kg CO₂ / tree / year | standard citation for "equal to N trees" |
| Reading interval | 1 hour | keeps 14 days downloadable |
| History | 14 days | enough to learn weekday+hour patterns |

Every one is labelled **assumed** wherever the UI shows it. Judges always ask
"where did this number come from", so they all live in one file (`ml/config.py`).

---

## 4. How I tested all this

**Without a server at first.** `ml/test_insights.py` builds a throwaway SQLite
database, loads the real `data/*.csv` into it, and runs the entire pipeline —
detection, tickets, predictions, verification, reports. Postgres-only types are
swapped for SQLite equivalents at runtime so `models.py` is never touched. One
command, no database, no server:

    .venv/bin/python ml/test_insights.py

**Then against the real database.** Once Ayaan sent the Supabase URL I seeded
all 11 tables (190,405 readings) and ran the whole thing for real:

```
run_all: 7 alerts, 6 auto-tickets (TK-9001..9006), 328 predictions
alerts carry entity_name, ts, severity, est_cost_inr_month, ticket_id
all /api/insights/* routes return 200 with contract shapes
```

---

## 5. Bugs I found and fixed (worth mentioning — shows rigour)

| Bug | Effect | Fix |
|---|---|---|
| Transformer had `room_id=NULL` | violated `NOT NULL`, seeding failed | gave it a utility room in B3 |
| `load_readings` used local time | tz-aware value string-compared wrongly, returned 0 rows | switched to UTC |
| Ghost load only checked the last 3 h | missed the planted overnight story | scan the whole night window |
| Night leak only checked the last 3 h | same | same |
| Alerts emitted `created_at` | frontend read `alert.ts` → **"Invalid Date"** | emit both |
| SLA was `4/24/72/168` | contract says `4/12/48/72` → showed 23.4h | now imports Ayaan's `app.constants` |
| Ticket evidence had no `explanation` | ticket drawer showed an empty box | carry the detector's own sentence |
| `whatif` took `{action}`, returned `{projected,...}` | frontend sends `{actions}`, reads `{scenario,...}` → **422 on a demo beat** | accept both, return both |
| Response field names differed from contract | frontend needed adapter shims | added contract-shaped aliases server-side |

The last three were caught by diffing the frontend client against my responses —
exactly the kind of thing that breaks on stage rather than in testing.

---

## 6. Things I did NOT do, and who owns them

- `frontend/` — Harshavi (`Insights.jsx` / `Reports.jsx` were still placeholders)
- `frontend/src/campus3d/` — Rishi
- `backend/` outside `insights/`, `app/constants.py` — Ayaan
- `.gitignore` — Harshavi

I never pushed to `main`; everything went through PRs (#4, #8, #9, #15, #19).

---

## 7. If someone asks "what is actually yours?"

> The synthetic campus data, the live simulator, and the whole decision layer —
> detection, auto-ticketing, failure prediction, fix verification, and the
> intervention/what-if reporting. Everything that decides *this is wrong, here
> is why, here is what it costs, here is what to do, and here is proof it worked.*

---

## 8. Demo script for my part (30 seconds)

1. **"This is a normal campus."** Point at the 3D map, buildings coloured by load.
2. **Press inject fault** on a lab. Within seconds it turns red.
3. **"It's not just red — it says why."** Read the alert card: *"Lab 101 is
   drawing 5.3 kW at 00:00 while the building is closed. ₹5,743/month."*
4. **"Nobody typed that. It raised its own ticket."** Show `TK-9002`.
5. **Complete the ticket.** Wait ~40 seconds. The badge flips to **verified** —
   *"power back to 3.2 kW, baseline 3.0 kW."*
6. **"And it checks itself — if the repair failed, the ticket reopens."**
7. Switch to interventions: **"here's what to fix first, and when it pays back."**
