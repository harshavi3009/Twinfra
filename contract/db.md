# Database contract (PostgreSQL)

Owner of schema code: **Ayaan** (`backend/app/models.py` or SQL file). Aditya's scripts read/write these same tables.
Change a column? Tell the team first. Add-only changes (new nullable column) are usually safe.

## IDs (strings, human-readable — makes demos and debugging easy)
`B1` building · `B1-F2` floor · `B1-F2-R03` room · `EQ-0042` equipment · `T-007` technician · `TK-0001` ticket · `UT-SUB`, `UT-TANK` utility nodes

## Default campus (synthetic; Aditya + Rishi may tweak, update here)
| id | name | floors | position x,z | size w,d |
|---|---|---|---|---|
| B1 | Main Academic Block | 3 | 0,0 | 40,16 |
| B2 | Computer & IT Block | 3 | 30,30 | 24,16 |
| B3 | Mechanical Workshop | 1 | -35,25 | 30,14 |
| B4 | Library | 2 | -30,-25 | 20,20 |
| B5 | Hostel | 4 | 35,-30 | 18,28 |
| B6 | Admin Block | 2 | 0,40 | 22,12 |
Utility nodes: `UT-SUB` substation (-50,0), `UT-TANK` water tank (50,0). Units: metres, ground plane y=0.

## Tables
**Asset hierarchy**
- `buildings(id PK, name, floors int, pos_x float, pos_z float, width float, depth float, open_time time, close_time time, open_days text)` — e.g. open_days `"Mon-Sat"`
- `floors(id PK, building_id FK, level int)`
- `rooms(id PK, floor_id FK, building_id FK, name, room_type text, capacity int)` — room_type: classroom | lab | office | workshop | hostel_room | library_hall | server_room
- `equipment(id PK, room_id FK, building_id FK, name, eq_type text, rated_kw float, owner_dept text, owner_name text, install_date date, warranty_until date, criticality text, status text, replacement_cost int)`
  - eq_type: ac | lighting | computers | pump | transformer | lathe | water_cooler | lift | server_rack
  - criticality: critical | high | medium | low · status: running | idle | fault | maintenance
- `connections(id serial PK, from_id text, to_id text, utility text)` — utility: electricity | water. Forms a tree: UT-SUB → B* → floor → equipment.

**Readings (time series)**
- `readings(id bigserial PK, ts timestamptz, entity_id text, metric text, value float, source text)`
  - entity_id: building, room or equipment id · metric: `power_kw` | `water_lpm` | `occupancy` · source: `csv` | `sim`
  - Index on `(entity_id, metric, ts)`.

**Maintenance & workforce**
- `maintenance_log(id serial PK, equipment_id FK, date date, action text, cost int, technician_id text, notes text)` — action: service | repair | part_replaced | inspection
- `technicians(id PK, name, skill text, phone text, active_tickets int default 0)` — skill: electrical | hvac | plumbing | mechanical | it
- `tickets(id PK, entity_id text, equipment_id text null, title, description, source text, priority text, status text, technician_id text null, created_at timestamptz, sla_due_at timestamptz, escalated bool default false, completed_at timestamptz null, completion_photo text null, completion_note text null, verification text default 'none', evidence jsonb null)`
  - source: auto | manual · priority: critical | high | medium | low
  - status: open | assigned | in_progress | done | closed
  - verification: none | pending | verified | failed
  - SLA by priority: critical 4h · high 12h · medium 48h · low 72h

**Insights (written by Aditya's ML code)**
- `alerts(id serial PK, ts timestamptz, entity_id text, metric text, kind text, actual float, expected float, ratio float, severity text, explanation text, est_cost_inr_month int null, active bool default true, ticket_id text null)`
  - kind: spike | ghost_load | night_leak | drift · severity: critical | high | medium | low
- `predictions(equipment_id PK, risk float, days_to_failure int, reasons jsonb, updated_at timestamptz)` — risk 0–1, reasons = list of short strings

## Constants (assumptions — show as "assumed" in UI/PPT)
Tariff ₹9/kWh · Grid emission factor 0.71 kg CO₂/kWh (check latest CEA value before PPT) · All data synthetic.
