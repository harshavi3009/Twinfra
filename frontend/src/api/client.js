// One function per endpoint in contract/api.md.
// VITE_USE_MOCK=true returns files from src/mocks/ instead of calling the backend.
import campusMock from '../mocks/campus.json'
import buildingMock from '../mocks/building_B1.json'
import equipmentMock from '../mocks/equipment_EQ-0042.json'
import alertsMock from '../mocks/alerts.json'
import ticketsMock from '../mocks/tickets.json'
import connectionsMock from '../mocks/connections.json'
import impactMock from '../mocks/impact.json'

// When the app is served BY the backend (tunnel, LAN, remote host), requests must
// go back to whatever origin served the page. Setting VITE_API_URL to an empty
// string means "same origin". Using `||` here would treat '' as unset and fall
// back to localhost, which resolves to the *phone* once the app is off-network.
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

// Mock mode: simulate a little network delay so loading states are visible.
const mock = (data, ms = 150) =>
  new Promise((resolve) => setTimeout(() => resolve(structuredClone(data)), ms))

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options)
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path} failed: ${res.status}`)
  return res.json()
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const qs = (params) => {
  const s = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null),
  ).toString()
  return s ? `?${s}` : ''
}

// The backend returns uploaded photos as /uploads/x.jpg; resolve them against the API host.
export const assetUrl = (path) =>
  !path || USE_MOCK || /^(blob:|https?:)/.test(path) ? path : `${BASE_URL}${path}`


// ---- Core ----
export const getCampus = () => (USE_MOCK ? mock(campusMock) : request('/api/campus'))

export const getBuilding = (id) =>
  USE_MOCK ? mock({ ...buildingMock, id }) : request(`/api/buildings/${id}`)

export const getRoom = (id) =>
  USE_MOCK
    ? mock({
        id,
        name: 'Lab 101',
        room_type: 'lab',
        status: 'critical',
        equipment: [
          { id: 'EQ-0042', name: 'Split AC 2', eq_type: 'ac', status: 'running', criticality: 'high', power_kw: 4.1, health: 'critical' },
        ],
      })
    : request(`/api/rooms/${id}`)

export const getEquipment = (id) =>
  USE_MOCK ? mock({ ...equipmentMock, id }) : request(`/api/equipment/${id}`)

export const getReadings = (entityId, metric = 'power_kw', hours = 24) => {
  if (USE_MOCK) {
    const now = Date.now()
    const points = Array.from({ length: hours }, (_, i) => {
      const ts = new Date(now - (hours - 1 - i) * 3600e3).toISOString()
      const baseline = 100 + 40 * Math.sin((i / 24) * Math.PI * 2)
      return { ts, value: +(baseline * (1 + (i > hours - 4 ? 0.25 : 0.03))).toFixed(1), baseline: +baseline.toFixed(1) }
    })
    return mock({ entity_id: entityId, metric, points, band: { low: 80, high: 135 } })
  }
  return request(`/api/readings${qs({ entity_id: entityId, metric, hours })}`)
}

export const postReadings = (readings) =>
  USE_MOCK ? mock({ inserted: readings.length }) : request('/api/readings', json('POST', { readings }))

// Mock mode really parses the CSV: checks the header, the entity ids and the numbers.
const KNOWN_ENTITY = /^(B[1-6]|B[1-6]-F\d-R\d{2}|EQ-\d{4})$/
const METRICS = ['power_kw', 'water_lpm', 'occupancy']

const parseCsvMock = async (file) => {
  const lines = (await file.text()).split(/\r?\n/).filter((l) => l.trim())
  const [header, ...rows] = lines
  const cols = (header || '').split(',').map((c) => c.trim())
  if (cols.join(',') !== 'ts,entity_id,metric,value') {
    throw new Error('Header must be exactly: ts,entity_id,metric,value')
  }
  const errors = []
  const valid = []
  rows.forEach((line, i) => {
    const row = i + 2 // +1 for header, +1 for 1-based
    const [ts, entity_id, metric, value] = line.split(',').map((c) => c.trim())
    if (!ts || Number.isNaN(Date.parse(ts))) return errors.push({ row, problem: `bad ts "${ts}"` })
    if (!KNOWN_ENTITY.test(entity_id || '')) return errors.push({ row, problem: `unknown entity_id ${entity_id}` })
    if (!METRICS.includes(metric)) return errors.push({ row, problem: `unknown metric ${metric}` })
    if (Number.isNaN(Number(value))) return errors.push({ row, problem: `value is not a number: ${value}` })
    valid.push({ ts, entity_id, metric, value: Number(value) })
  })
  return { rows: rows.length, valid, errors }
}

export const importCsv = async (file, commit = false) => {
  if (USE_MOCK) {
    const { rows, valid, errors } = await parseCsvMock(file)
    return mock({
      rows,
      valid: valid.length,
      errors: errors.slice(0, 50),
      preview: valid.slice(0, 5),
      ...(commit ? { inserted: valid.length } : {}),
    }, 400)
  }
  const form = new FormData()
  form.append('file', file)
  return request(`/api/import/csv?commit=${commit}`, { method: 'POST', body: form })
}

export const getConnections = () => (USE_MOCK ? mock(connectionsMock) : request('/api/connections'))

export const getImpact = (id) =>
  USE_MOCK
    ? mock({ id, affected: impactMock[id] ?? { rooms: 8, equipment: 31, ids: [] } })
    : request(`/api/connections/${id}/impact`)

// ---- Tickets & technicians ----
// Mock mode keeps mutable copies so the board, drawer and technician view behave like the real API.
const mockTickets = structuredClone(ticketsMock)
const mockTechnicians = [
  { id: 'T-001', name: 'Suresh Patil', skill: 'mechanical' },
  { id: 'T-002', name: 'Anita Rao', skill: 'electrical' },
  { id: 'T-003', name: 'Ravi Kumar', skill: 'plumbing' },
]
const SLA_HOURS = { critical: 4, high: 12, medium: 48, low: 72 }
let mockSeq = 5

const isOpenStatus = (s) => !['done', 'closed'].includes(s)
const activeCount = (techId) =>
  mockTickets.filter((t) => t.technician?.id === techId && isOpenStatus(t.status)).length
// Recompute the countdown from sla_due_at so the number is live.
const withSla = (t) => ({ ...t, sla_seconds_left: Math.max(0, Math.round((new Date(t.sla_due_at) - Date.now()) / 1000)) })

export const getTickets = (status) =>
  USE_MOCK
    ? mock((status ? mockTickets.filter((t) => t.status === status) : mockTickets).map(withSla))
    : request(`/api/tickets${qs({ status })}`)

export const createTicket = (body) => {
  if (!USE_MOCK) return request('/api/tickets', json('POST', body))
  const now = new Date()
  const ticket = {
    equipment_id: null,
    description: '',
    evidence: null,
    id: `TK-${String(mockSeq++).padStart(4, '0')}`,
    source: 'manual',
    status: 'open',
    technician: null,
    created_at: now.toISOString(),
    sla_due_at: new Date(now.getTime() + SLA_HOURS[body.priority] * 3600e3).toISOString(),
    escalated: false,
    verification: 'none',
    ...body,
  }
  mockTickets.unshift(ticket)
  return mock(withSla(ticket))
}

export const updateTicket = (id, body) => {
  if (!USE_MOCK) return request(`/api/tickets/${id}`, json('PATCH', body))
  const t = mockTickets.find((x) => x.id === id)
  if (body.technician_id !== undefined) {
    const tech = mockTechnicians.find((x) => x.id === body.technician_id)
    t.technician = tech ? { id: tech.id, name: tech.name } : null
    if (tech && t.status === 'open') t.status = 'assigned'
  }
  if (body.status) t.status = body.status
  return mock(withSla(t))
}

export const completeTicket = (id, note, photo) => {
  if (!USE_MOCK) {
    const form = new FormData()
    form.append('note', note)
    if (photo) form.append('photo', photo)
    return request(`/api/tickets/${id}/complete`, { method: 'POST', body: form })
  }
  const t = mockTickets.find((x) => x.id === id)
  Object.assign(t, {
    status: 'done',
    verification: 'pending',
    completed_at: new Date().toISOString(),
    completion_note: note,
    completion_photo: photo ? URL.createObjectURL(photo) : null,
  })
  // The real backend re-checks live readings; the mock resolves to "verified" after 4 s.
  setTimeout(() => (t.verification = 'verified'), 4000)
  return mock(withSla(t))
}

export const getTechnicians = () =>
  USE_MOCK
    ? mock(mockTechnicians.map((t) => ({ ...t, active_tickets: activeCount(t.id) })))
    : request('/api/technicians')

export const suggestTechnicians = (ticketId) =>
  USE_MOCK
    ? mock(
        mockTechnicians
          .map((t) => ({ ...t, active_tickets: activeCount(t.id) }))
          .sort((a, b) => a.active_tickets - b.active_tickets)
          .map((t) => ({ ...t, reason: t.active_tickets === 0 ? 'Free now' : `${t.active_tickets} active ticket(s)` })),
      )
    : request(`/api/technicians/suggest${qs({ ticket_id: ticketId })}`)

// ---- Insights (Aditya) ----
// Mock mode keeps a mutable copy so "Inject fault" in the demo toolbar adds a real alert.
const mockAlerts = structuredClone(alertsMock)

export const getAlerts = (active = true) =>
  USE_MOCK ? mock(mockAlerts) : request(`/api/insights/alerts${qs({ active })}`)

export const runInsights = () =>
  USE_MOCK ? mock({ alerts_new: 0, tickets_created: 0, verified: 0 }) : request('/api/insights/run', { method: 'POST' })

export const injectFault = (entity_id, kind) => {
  if (!USE_MOCK) return request('/api/insights/sim/fault', json('POST', { entity_id, kind }))
  mockAlerts.unshift({
    id: Date.now(),
    ts: new Date().toISOString(),
    entity_id,
    entity_name: entity_id,
    kind,
    metric: kind === 'night_leak' ? 'water_lpm' : 'power_kw',
    actual: 20,
    expected: 8,
    ratio: 2.5,
    severity: 'critical',
    explanation: `Injected demo fault (${kind}) on ${entity_id}.`,
    est_cost_inr_month: 15000,
    ticket_id: null,
  })
  return mock({ ok: true })
}

export const getFaults = () => (USE_MOCK ? mock([]) : request('/api/insights/sim/faults'))

// Assumed constants from contract/db.md: tariff ₹9/kWh, grid factor 0.71 kg CO₂/kWh.
const TARIFF = 9
const CO2_PER_KWH = 0.71
const BASE_KWH_MONTH = 182000

// What-if actions as the backend names them, with the share of load each one removes.
// Mirrors WHATIF_LIBRARY in backend/app/insights/reporting.py.
const WHATIF_REDUCTION = { led_retrofit: 0.4, schedule_ac: 0.22, fix_ghost_load: 0.9, solar_roof: 0.15 }

const INTERVENTIONS = [
  { rank: 1, title: 'Fix ghost load in Lab 101', entity_id: 'B1-F1-R01', risk: 'low', downtime_hours: 1, cost_inr: 2500, savings_inr_month: 18400, payback_months: 0.1, score: 0.94, why: 'Lab 101 draws 2.5x its normal power while empty. Switching off idle equipment costs almost nothing.' },
  { rank: 2, title: 'Replace Split AC 2 before it fails', entity_id: 'EQ-0042', risk: 'medium', downtime_hours: 6, cost_inr: 45000, savings_inr_month: 6200, payback_months: 7.3, score: 0.81, why: 'Predicted failure in ~9 days (risk 82%). A planned swap avoids an emergency repair.' },
  { rank: 3, title: 'Fix night water leak in Hostel', entity_id: 'B5', risk: 'low', downtime_hours: 2, cost_inr: 4000, savings_inr_month: 5200, payback_months: 0.8, score: 0.77, why: 'Water keeps flowing overnight at about 2.4x normal. A cheap valve or pipe fix stops the waste.' },
  { rank: 4, title: 'LED retrofit in Main Academic Block', entity_id: 'B1', risk: 'low', downtime_hours: 8, cost_inr: 120000, savings_inr_month: 14500, payback_months: 8.3, score: 0.69, why: 'Lighting is a large share of B1 power. LEDs cut that load for the same light.' },
  { rank: 5, title: 'AC setpoint 22→26 °C in IT Block', entity_id: 'B2', risk: 'low', downtime_hours: 0, cost_inr: 0, savings_inr_month: 9800, payback_months: 0, score: 0.66, why: 'Raising the setpoint 4 °C lowers cooling load with no capital cost.' },
]

// The backend's insights routes use their own field names. The adapters below map them to the
// contract shapes the UI reads. Remove them once contract/api.md and the routes agree.
const GRADE = (score) => (score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 45 ? 'D' : 'F')
const RISK_FROM_SEVERITY = { critical: 'high', high: 'high', medium: 'medium', low: 'low' }

const toIntervention = (i, n) => ({
  rank: n + 1,
  title: i.title,
  entity_id: i.entity_id,
  risk: RISK_FROM_SEVERITY[i.severity] || 'low',
  downtime_hours: null, // the backend does not estimate downtime yet
  cost_inr: i.capex_inr,
  savings_inr_month: i.saving_inr_month,
  payback_months: i.payback_months,
  score: null,
  why: i.reason,
})

export const getInterventions = async () => {
  if (USE_MOCK) return mock(INTERVENTIONS)
  const rows = await request('/api/insights/interventions')
  return rows.map(toIntervention)
}

const whatIfCard = (kwh) => ({
  kwh_month: Math.round(kwh),
  cost_inr: Math.round(kwh * TARIFF),
  co2_kg: Math.round(kwh * CO2_PER_KWH),
})

// `keep` is the share of today's load left after the actions (0..1).
const whatIfResult = (buildings, baseKwh, keep) => {
  const savedKwh = baseKwh * (1 - keep)
  return {
    baseline: whatIfCard(baseKwh),
    scenario: whatIfCard(baseKwh * keep),
    savings: { kwh_month: Math.round(savedKwh), cost_inr: Math.round(savedKwh * TARIFF), co2_kg: Math.round(savedKwh * CO2_PER_KWH) },
    per_building: buildings.map((b) => {
      const after = +(b.power_kw * keep).toFixed(1)
      return { id: b.id, power_kw_after: after, status_after: after > b.baseline_kw * 1.15 ? 'warning' : 'ok' }
    }),
  }
}

// `actions` are backend action names, e.g. ['led_retrofit', 'schedule_ac'].
export const runWhatIf = async (actions) => {
  if (USE_MOCK) {
    const keep = actions.reduce((k, a) => k * (1 - (WHATIF_REDUCTION[a] || 0)), 1)
    return mock(whatIfResult(campusMock.buildings, BASE_KWH_MONTH, keep))
  }
  const [r, campus] = await Promise.all([
    request('/api/insights/whatif', json('POST', { actions })),
    getCampus(),
  ])
  const keep = r.baseline.kwh ? r.projected.kwh / r.baseline.kwh : 1
  return whatIfResult(campus.buildings, r.baseline.kwh, keep)
}

export const getSustainabilityReport = async (days = 30) => {
  if (USE_MOCK) {
    const kwh = Math.round(BASE_KWH_MONTH * (days / 30))
    return mock({
      kwh,
      water_kl: Math.round(campusMock.totals.water_lpm * 60 * 24 * (days / 1000)),
      co2_kg: Math.round(kwh * CO2_PER_KWH),
      cost_inr: Math.round(kwh * TARIFF),
      vs_prev_pct: -4.2,
      score: 72,
      trees_equiv: Math.round((kwh * CO2_PER_KWH) / 21), // assumed: ~21 kg CO₂ absorbed per tree per year
      by_building: campusMock.buildings.map((b) => ({ id: b.id, name: b.name, kwh: Math.round(kwh * (b.power_kw / campusMock.totals.power_kw)) })),
    })
  }
  const [r, campus] = await Promise.all([
    request(`/api/insights/reports/sustainability${qs({ days })}`),
    getCampus(),
  ])
  const names = Object.fromEntries(campus.buildings.map((b) => [b.id, b.name]))
  return {
    ...r,
    by_building: r.by_building.map((b) => ({ id: b.building_id, name: names[b.building_id] || b.building_id, kwh: b.kwh })),
  }
}

export const getAssetHealthReport = async () => {
  if (USE_MOCK) {
    return mock({
      buildings: [
        { id: 'B1', grade: 'C', score: 61 },
        { id: 'B2', grade: 'D', score: 48 },
        { id: 'B3', grade: 'B', score: 79 },
        { id: 'B4', grade: 'A', score: 92 },
        { id: 'B5', grade: 'B', score: 74 },
        { id: 'B6', grade: 'A', score: 90 },
      ],
      worst_assets: [
        { id: 'EQ-0042', name: 'Split AC 2', risk: 0.82, reason: 'High runtime, 2 anomalies in 7 days' },
        { id: 'EQ-0120', name: 'Lathe 3', risk: 0.64, reason: 'Vibration reported, repair in last 90 days' },
      ],
    })
  }
  const r = await request('/api/insights/reports/asset-health')
  return {
    buildings: r.buildings.map((b) => ({ id: b.building_id, grade: GRADE(b.health_score), score: b.health_score })),
    worst_assets: r.worst_assets.map((a) => ({
      id: a.equipment_id,
      name: a.name,
      risk: a.risk,
      reason: a.reasons.length ? a.reasons.join(' · ') : `${a.criticality} criticality`,
    })),
  }
}
