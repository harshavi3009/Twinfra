# What I Built — Aditya

> A plain-English walkthrough of everything I did on Twinfra.
> Written so I can read it out loud to a judge without notes.
> No jargon where a normal word would do.

**Last updated:** after the hand-gesture work.

---

## 1. Where I fit in

HackNova 2026, Problem Statement 12: **Campus Digital Twin**.
Four people, one repo (`harshavi3009/Twinfra`).

| Person | Owns |
|---|---|
| Harshavi | `frontend/` (except the 3D folder), `docs/` |
| Rishi | `frontend/src/campus3d/` — the 3D campus |
| Ayaan | `backend/` (except the insights folder) |
| **Me** | **`ml/`, `data/`, `backend/app/insights/`** |

I never touched anyone else's files. Where I needed something from their code,
I left a clean seam and told them about it.

---

## 2. The pitch, in one sentence

> A 3D model of the campus that **notices when something is wasting power or
> about to break**, explains **why** in everyday words, **raises the repair
> ticket itself**, and then **proves the repair worked**.

Three people built the face of it — the 3D, the dashboard, the database.
**I built the brain.** Everything that decides *"this is wrong, here's why,
here's what it costs, here's what to do about it."*

---

## 3. Stage 1 — I invented a believable campus (D1)

**The problem:** no real college is feeding us live data. A demo with an empty
database is a dead demo.

**What I did:** wrote a generator that invents an entire campus — buildings,
rooms, devices, staff, a year of repair history, and two weeks of hourly sensor
readings.

```
6 buildings · 15 floors · 109 rooms · 328 devices
which produce 190,405 sensor readings
```

**The important part: the data isn't random noise.** Random numbers look fake
instantly. So the readings follow how a real campus actually behaves:

- classrooms and offices are busy 9am–5pm, empty at night, dead on Sunday
- air conditioners work harder in the afternoon heat
- labs only draw heavy power when there's a class timetabled
- hostels are the opposite — busy at night, quiet in the day
- **a building's total is the sum of its rooms**, so two screens can never
  disagree with each other

Then I **planted four stories** — things that are wrong and that my detection
code is supposed to find on its own:

| Planted story | What it looks like | What it really is |
|---|---|---|
| Ghost load in `B2-F1-R01` | ~4.2 kW of AC and lights at midnight, zero people inside | equipment left running in an empty lab |
| Night leak in building B5 | ~5.4 litres/min of water at 2am | a leaking pipe nobody has noticed |
| Drifting transformer `EQ-0328` | load creeping up ~6% over two weeks | ageing equipment, before it fails |
| Bad AC `EQ-0001` | repaired 3 times in 6 months, warranty ending | should be replaced, not repaired again |

When a judge sees an alert pop up, it's one of these. When they ask "was that
scripted?", the honest answer is: *the data was planted, the detection was not —
the system found them by itself.*

Everything is generated from a fixed seed, so Harshavi, Rishi, Ayaan and I all
have the identical campus. Any screenshot I take matches anyone else's.

---

## 4. Stage 2 — making the campus feel alive (D2)

**The problem:** a static CSV can't be demoed. You need numbers to move while
people are watching.

**What I did:** a simulator that pretends the campus is running *right now*. Every
3 seconds it generates the current hour's readings for every room and device and
pushes them into the database. Every third tick it asks the backend to run
detection.

It runs faster than real time — with `--speed 5`, five simulated hours pass per
tick, so a whole day goes by in about a minute.

**The part that makes judges lean forward: fault injection.**

Instead of hoping a fault happens to appear while they're watching, we decide
when. One API call, and a specific room starts misbehaving:

1. Someone calls `POST /api/insights/sim/fault` saying *"make
   `B1-F2-R01` spike"*.
2. My `faults.py` remembers it.
3. On its next tick the simulator **bends its own numbers** — that room now
   draws 2–3× normal power, **and so does its floor and its building**.
4. Within seconds the room turns red on screen.

That "and so does its building" line matters more than it looks. Those are the
meter readings a real technician would see. A room can't spike without its
building meter noticing, so we simulate it honestly instead of putting a red dot
on a room and hoping nobody checks the building total.

Three kinds of fault:

| Kind | What it does | Why it's realistic |
|---|---|---|
| `spike` | 2–3× normal power | a failing motor or a short circuit |
| `ghost_load` | +4.2 kW, occupancy forced to 0 | equipment left on in an empty room |
| `night_leak` | +5.4 l/min water | a burst or leaking pipe |

And when a technician fixes it, the fault is cleared, the numbers fall back to
normal — and **something is watching that be normal again.** That's stage 3.

---

## 5. Stage 3 — the actual intelligence (D3)

This is the heart of what I built. Four things: **detect, predict, ticket,
verify.**

### 5.1 Detection — "normal" is not one number

The naive way is to average a device's power and flag anything far above it.
That fails badly: a lab's 2pm Tuesday usage is nothing like its 3am Sunday
usage, so a single average flags everything, forever.

So for every device and metric I compute **what normal looks like for this
weekday at this hour**. Compare Tuesday 2pm to every previous Tuesday 2pm.

Then four detectors compare today's reading against that:

| Detector | Rule | Catches |
|---|---|---|
| `spike` | above normal + 3σ, or 1.8× normal | a failing motor, a short |
| `ghost_load` | drawing power overnight with nobody in the room | equipment left running |
| `night_leak` | water flowing overnight with nobody there | a leaking pipe |
| `drift` | this week's average ≥15% above last week's | ageing, *before* it breaks |

All four found the stories I planted in stage 1. They weren't told where to look.

`drift` is the one I'd point at if a judge asks "what's clever here?" — it's the
only one that notices something **going wrong slowly**. Everyone builds a
threshold alarm. Drift catches the transformer before it fails.

### 5.2 Auto-tickets — the system files its own repair requests

A serious alert (`critical` or `high`) **raises a repair ticket by itself**, with
the alert attached as evidence: what was measured, what was expected, the ratio,
and the ₹/month being wasted.

- tickets carry an SLA deadline by severity (4 hours critical, 24 high)
- **one open ticket per problem**, so a fault that lasts all night doesn't spawn
  200 duplicate tickets
- the technician is **deliberately left unassigned** — the system suggests the
  right person, a human clicks assign

That last one is a design decision I'd defend in the Q&A. Full automation reads
as a toy. *"The system tells you who to send, you decide"* is how a real estate
office works, and it's a better demo because the judge can see a human in the
loop.

### 5.3 Failure prediction — which device will break next

A **RandomForest** (scikit-learn) looks at 7 things per device: age, days since
last service, repairs in the last 6 months, anomalies this week, current load vs
rated load, warranty left, and how critical the asset is.

It outputs:
- a **risk score** from 0 to 1
- estimated **days to failure**
- the 2–3 strongest reasons **in plain words** — *"3 anomalies in the last 7
  days"*, *"drawing 140% of its rated load"*

I'm honest about the limitation: the model is trained on plausible-but-synthetic
labels, because a two-week-old campus has no real failure history. We say that
openly rather than pretending.

One thing I had to fix: the raw probability came out compressed — every device
scored around 0.7, which is useless for ranking. So the final risk blends the
model's probability with the device's **percentile rank on campus**. The
ordering is the model's; the number now spreads across 0–1 and means *"how bad
is this compared to everything else here"*.

### 5.4 Fix verification — the feature that makes the demo land

**This is the one I'd put on the slide.**

When a technician marks a ticket done, **the system does not believe them.**

1. Wait 30 seconds for the fix to show up in the meter
2. Watch for up to 2 minutes
3. Readings back within 1.5× of normal → ticket marked **`verified`**
4. Still out of band → marked **`failed`, and the ticket reopens by itself**

So the demo can say *"the repair worked — here's the meter proving it"*, and can
also say *"the repair did not work, and here's the ticket that reopened itself."*

That second one is worth rehearsing. A system that admits a fix failed is far
more convincing than one that always shows green. I tested and confirmed both
paths work.

---

## 6. Stage 4 — reports (D4)

Four things, all built in the same commit:

- **Interventions** — every active alert turned into a proposal with a ₹/month
  saving and a **payback period in months**, sorted by saving. Answers *"okay,
  what do we spend the maintenance budget on first?"* directly.
- **What-if** — `POST /api/insights/whatif` with `led_retrofit`, `schedule_ac`,
  `fix_ghost_load` or `solar_roof`. Returns baseline vs projected kWh, ₹ and
  CO₂ — and a per-building breakdown so the 3D map can recolour itself.
- **Sustainability report** — kWh, water, CO₂, ₹, *"equivalent to N trees"*, a
  0–100 score, per-building split.
- **Asset health** — a health score per building plus the 20 riskiest assets.

---

## 7. The hand-gesture control (stretch goal)

Rishi built a 3D campus you can fly around with a mouse. For the demo, I added
**webcam hand control** — you point at the screen and the camera follows your
hand.

| Gesture | Action |
|---|---|
| Open palm, move | rotate the campus |
| Fist, move | pan |
| Thumbs up, move closer/further | zoom |
| Peace sign, hold 1s | explode the building into floors |
| Point → pinch | select a building |

**All of it runs on the laptop. Nothing goes to the internet.** That was a
deliberate call: venue wifi will not reliably pull a 7.5 MB model while a judge
watches. I bundled the AI model and its runtime into the project so the demo
cannot be killed by bad wifi. I could not have done a live AI demo otherwise.

Hand control is **off by default**. The demo must never depend on a webcam
working — press `G` to turn it on.

### What went wrong, and why it's worth mentioning

This feature took **nine rounds of fixing**, and the honest story is more
impressive than claiming it worked first time:

1. **The model was being downloaded from the internet.** I'd bundled the runtime
   but not the model file. The exact failure I built the local copy to prevent.
2. **The gesture classifier was wrong.** It measured fingers against fixed
   numbers; real fists never fold perfectly, so a fist read as "point" and a
   peace sign read as "open hand". I rewrote it to compare fingers *to each
   other* instead of to fixed numbers.
3. **Commands were being thrown away.** The camera could only hold one command
   at a time. Pan and zoom arrive together, so zoom overwrote pan every frame —
   pan was *never* arriving. No amount of tuning could have fixed that.
4. **Zoom never moved the camera.** My code asked the camera library for
   something it doesn't have, which crashed the render loop on every zoom.
5. **Pan was multiplied twice** by two different numbers in two files, giving a
   speed nobody chose.

The lesson I'd actually say out loud: **I spent the first three rounds tuning
numbers, which was guesswork.** It only started working when I *measured* — wrote
a script that reads the camera's actual position before and after a gesture and
prints how far it moved. Then the bugs became obvious.

That's a genuinely good thing to say to judges, because it's the difference
between guessing and engineering.

### How I proved it works

Instead of eyeballing it, I drove real gestures through the real code and
measured the camera:

```
PAN     moved 1040.0 units
ROTATE  moved  255.3 units
ZOOM    moved   26.0 units
SELECT  opens the side panel   ✓
EXPLODE works                  ✓
57/57 commands delivered, 0 dropped, 0 console errors
```

---

## 8. Bugs I found in code that wasn't mine to write

While integrating, I found real bugs and reported them rather than silently
patching other people's files:

| Bug | Effect | Fix |
|---|---|---|
| Alerts sent `created_at`, UI read `ts` | every alert showed "Invalid Date" | API now emits both |
| SLA was 4/24/72/168 hours | drifted from the shared constant | imports one source of truth |
| Ticket evidence had no explanation field | UI showed a blank reason | explanation now carried |
| What-if endpoint returned 422 | frontend called it two different ways | accepts both, returns both |
| Transformer readings had no room | 108 rooms instead of 109 | assigned to a utility room |
| Timestamps saved as local time | off-by-hours plots | stored as UTC |

---

## 9. The numbers I use, and why

Judges always ask *"why that number?"* — which is why they all live in one file
(`ml/config.py`) and are labelled **assumed** wherever they appear on screen.

| Constant | Value | Why |
|---|---|---|
| Electricity tariff | ₹9 / kWh | typical Indian institutional rate |
| Grid emissions | 0.71 kg CO₂ / kWh | CEA grid factor |
| Tree absorption | 21 kg CO₂ / tree / year | standard citation, for "= N trees" |
| Reading interval | 1 hour | keeps 14 days to a sane file size |
| History | 14 days | enough to learn weekday + hour patterns |

---

## 10. How the pieces connect

```
my generator  ──writes──►  data/*.csv
                                │
                                ▼
                        Ayaan's database
                                │
      ┌─────────────────────────┼─────────────────────────┐
      │                         │                         │
my simulator              my detection              Ayaan's API
(every 3 s)               (alerts, ML)              (campus, tickets)
      │                         │                         │
      └────────►  readings  ◄───┴─────────────────────────┘
                                │
                                ▼
                        Harshavi's React UI
```

**The one line worth saying out loud:** *the simulator writes, the detectors
read.* They never call each other directly, so any of us can change our own side
without breaking the other's.

---

## 11. How I tested without a working server

`ml/test_insights.py` builds a throwaway SQLite database, loads the real CSVs,
and runs the **entire pipeline** — detection, tickets, predictions,
verification, reports — in one command:

```
.venv/bin/python ml/test_insights.py
```

No server, no database to install. That meant I could keep working when the
shared database was down or someone else's code was mid-change.

I also ran the whole thing end-to-end against the shared Postgres: 11 tables,
190,405 readings, every `/api/insights/*` route returning its documented shape.

---

## 12. Demo script — what to click, in order

**The 90-second version:**

1. **Overview** — the live campus. "Everything you see is simulated from a
   generator I wrote; the numbers behave like a real campus — busy in the day,
   quiet at night, dead on Sundays."
2. **Alerts** — point at the ghost load. "Nobody switched that lab's AC off at
   midnight. That's 4 kW burning for five hours a night, about ₹1,200 a month."
3. **Tickets** — "The system raised that ticket itself, with the evidence
   attached and a 4-hour SLA."
4. **Assets** — "This is the prediction. That transformer's load has crept up 6%
   in two weeks — it's ageing."
5. **Complete the ticket** → verification runs. "Notice it hasn't said 'fixed'.
   It's watching the meter. It'll only say verified when the numbers agree."
6. **Reports → What-if** → LED retrofit. "₹X a month, CO₂ down, and the buildings
   recolour to show the effect."
7. *(press `G`)* **Hand control** — palm to rotate, fist to pan, thumbs up to
   zoom, peace to explode a building. "All running locally — no internet, no
   cloud, nothing can fail on stage."

**If something breaks:** hand control is a stretch feature, press `G` off and
use the mouse. Nothing in the demo depends on it.

---

## 13. Questions a judge will ask, and my answers

**"Is this data real?"**
No — it's synthetic, and we say so on screen. What's real is the *detection*.
We planted four known problems and the system found them without being told
where to look.

**"Isn't this just thresholds?"**
Partly. Two of the four detectors are thresholds. But the prediction is a
trained RandomForest, and `drift` catches things getting worse *slowly* — which
no threshold does.

**"What happens when a fix doesn't work?"**
That's the best question you could ask. The system reopens the ticket by itself.
We can demo exactly that.

**"Why should a college care?"**
Because it finds money nobody is counting — that ghost load is ₹1,200/month
burning invisibly — and it tells the estate office *which repair to do first*
instead of by gut feel.

**"What's not finished?"**
Insights and Reports pages are still placeholders on the frontend (Harshavi's
area) — the API behind them is done and returns real numbers. And the failure
model is trained on synthetic labels, because a two-week-old campus has no real
failure history. We'd need one semester of real data before trusting that score
in production.

---

## 14. If I had one more day

1. **Real historical data** — even three months from one real building would let
   the prediction model be trained on truth instead of plausible guesses.
2. **Insights + Reports pages** — two demo beats currently have no UI behind
   them.
3. **Retrain on feedback** — right now, a technician marking "not actually
   broken" teaches the system nothing. That's the obvious next step, and it's
   what turns a demo into a product.

---

## Appendix — the files I own

| Path | What's in it |
|---|---|
| `ml/config.py` | every tunable number, in one place |
| `ml/generate_data.py` | builds the whole campus + plants the four stories |
| `ml/simulator.py` | live tick loop, fault injection, `--speed` / `--once` / `--dry-run` |
| `ml/test_insights.py` | whole pipeline against SQLite, no server needed |
| `backend/app/insights/detect.py` | baselines + the four detectors |
| `backend/app/insights/predict.py` | RandomForest risk scoring |
| `backend/app/insights/tickets.py` | auto-ticketing, SLA, dedupe |
| `backend/app/insights/verify.py` | proves a repair worked, reopens if not |
| `backend/app/insights/faults.py` | injected demo faults |
| `backend/app/insights/reporting.py` | `run_all()` + the D4 reports |
| `backend/app/insights/router.py` | `/api/insights/*` endpoints |
| `backend/app/insights/common.py` | shared maths: baselines, ₹, CO₂ |
| `data/*.csv` | 8 tables of generated campus data |
| `frontend/src/gestures/` | webcam hand control (stretch goal) |

**Run it:**

```bash
.venv/bin/python ml/generate_data.py        # rebuild the campus
.venv/bin/python ml/simulator.py --speed 5  # live tick, 5 hours per tick
.venv/bin/python ml/test_insights.py        # full pipeline test, no DB needed
```
