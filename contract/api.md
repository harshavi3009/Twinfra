# API contract (FastAPI ↔ React)

Base URL `http://localhost:8000`. All JSON. Times are ISO strings. Money in ₹ (int).
Owners: Ayaan = core routes · Aditya = everything under `/api/insights` (file `backend/app/insights/`).
Frontend builds against **mock files with these exact shapes** until the real route works.

## Shared enums
`status` (building/room/equipment health): `ok | warning | critical | offline`

## Core (Ayaan)
**GET /api/campus** — whole campus for dashboard + 3D
```json
{ "buildings": [ { "id":"B1","name":"Main Academic Block","floors":3,
    "position":{"x":0,"z":0},"size":{"w":40,"d":16},
    "status":"warning","power_kw":182.4,"baseline_kw":150.0,
    "water_lpm":40.2,"occupancy":420,"active_alerts":2 } ],
  "utilities": [ {"id":"UT-SUB","type":"substation","position":{"x":-50,"z":0}} ],
  "totals": {"power_kw":640.1,"baseline_kw":590.0,"water_lpm":210.5,"occupancy":1830,"active_alerts":5,"open_tickets":3} }
```
**GET /api/buildings/{id}** — floors → rooms
```json
{ "id":"B1","name":"...","floors":[ {"id":"B1-F1","level":1,"rooms":[
    {"id":"B1-F1-R01","name":"Lab 101","room_type":"lab","status":"critical",
     "power_kw":12.3,"baseline_kw":5.0,"occupancy":0,"equipment_count":6} ]} ] }
```
**GET /api/rooms/{id}** — `{ "id","name","room_type","status", "equipment":[ EquipmentSummary ] }`
EquipmentSummary = `{"id","name","eq_type","status","criticality","power_kw","health":"ok|warning|critical"}`

**GET /api/equipment/{id}** — asset card
```json
{ "id":"EQ-0042","name":"Split AC 2","eq_type":"ac","room_id":"B1-F1-R01","building_id":"B1",
  "rated_kw":2.2,"power_kw":4.1,"status":"running","criticality":"high",
  "owner_dept":"Civil","owner_name":"Prof. X","install_date":"2021-06-01",
  "warranty_until":"2026-11-12","warranty_days_left":12,"replacement_cost":45000,
  "history":[ {"date":"2026-08-03","action":"repair","cost":3500,"notes":"compressor"} ],
  "prediction": {"risk":0.82,"days_to_failure":9,"reasons":["High runtime","2 anomalies in 7 days"]},
  "open_ticket_id":"TK-0004" }
```
**GET /api/readings?entity_id=B1&metric=power_kw&hours=24**
`{ "entity_id","metric","points":[{"ts","value","baseline"}], "band":{"low":..,"high":..} }`
(baseline per point = typical value for that weekday+hour; Aditya provides the helper, Ayaan exposes it.)

**POST /api/readings** — simulator pushes a batch: `{ "readings":[{"ts","entity_id","metric","value"}] }` → `{"inserted":n}`

**POST /api/import/csv?commit=false** — multipart file. Columns `ts,entity_id,metric,value`.
→ `{ "rows":500, "valid":488, "errors":[{"row":12,"problem":"unknown entity_id B9"}], "preview":[...first 5] }`; `commit=true` imports valid rows.

**GET /api/connections** — `{ "nodes":[{"id","type"}], "edges":[{"from","to","utility"}] }`
**GET /api/connections/{id}/impact** — `{ "id":"B1-F2","affected":{"rooms":8,"equipment":31,"ids":[...]} }`

**Tickets & technicians**
- GET `/api/tickets?status=open` → `[Ticket]`
- POST `/api/tickets` `{entity_id, equipment_id?, title, description, priority}` → Ticket
- PATCH `/api/tickets/{id}` `{status?, technician_id?}` → Ticket
- POST `/api/tickets/{id}/complete` multipart `photo` (optional) + `note` → Ticket (sets status `done`, verification `pending`, calls `insights.clear_fault(entity)`)
- GET `/api/technicians` → `[{id,name,skill,active_tickets}]`
- GET `/api/technicians/suggest?ticket_id=TK-1` → `[{id,name,skill,active_tickets,reason}]` best first

Ticket = `{id,entity_id,equipment_id,title,description,source,priority,status,technician:{id,name}|null,created_at,sla_due_at,sla_seconds_left,escalated,verification,evidence}`

## Insights (Aditya)
- GET `/api/insights/alerts?active=true` → `[{id,ts,entity_id,entity_name,kind,metric,actual,expected,ratio,severity,explanation,est_cost_inr_month,ticket_id}]`
- POST `/api/insights/run` → runs detection + predictions + verification once → `{alerts_new, tickets_created, verified}`
- POST `/api/insights/sim/fault` `{entity_id, kind:"spike|ghost_load|night_leak"}` → injects a demo fault · GET `/api/insights/sim/faults` → active faults (simulator reads this)
- GET `/api/insights/interventions` → `[{rank,title,entity_id,risk,downtime_hours,cost_inr,savings_inr_month,payback_months,score,why}]`
- POST `/api/insights/whatif` `{actions:[{type:"led_retrofit"|"ac_setpoint"|"close_after"|"replace_equipment", target:"B1"|"all", value?}]}` → `{baseline:{kwh_month,cost_inr,co2_kg}, scenario:{...}, savings:{...}, per_building:[{id,power_kw_after,status_after}]}`
- GET `/api/insights/reports/sustainability?days=30` → `{kwh, water_kl, co2_kg, cost_inr, vs_prev_pct, score, trees_equiv, by_building:[...]}`
- GET `/api/insights/reports/asset-health` → `{buildings:[{id,grade:"A-F",score}], worst_assets:[{id,name,risk,reason}]}`

## Frontend ↔ 3D component (Harshavi ↔ Rishi)
```jsx
<Campus3D
  campus={campusJson}            // GET /api/campus
  buildingDetail={detailOrNull}  // GET /api/buildings/{id} for the selected building
  selection={{buildingId, floorId, roomId, equipmentId}}  // null fields allowed
  onSelect={(sel) => {}}         // same shape as selection
  connections={connectionsJson}  // optional, for flow lines
  highlightIds={["B1-F2-R01"]}   // e.g. impact analysis results
  whatIf={perBuildingOrNull}     // from /api/insights/whatif, recolors buildings
  timeOfDay={"day"|"night"}
/>
```
Rishi exports it from `frontend/src/campus3d/index.jsx`. Colors: ok `#22c55e`, warning `#f59e0b`, critical `#ef4444` (pulse), offline `#64748b`.
