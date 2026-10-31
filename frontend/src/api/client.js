// One function per endpoint in contract/api.md.
// VITE_USE_MOCK=true returns files from src/mocks/ instead of calling the backend.
import campusMock from '../mocks/campus.json'
import buildingMock from '../mocks/building_B1.json'
import equipmentMock from '../mocks/equipment_EQ-0042.json'
import alertsMock from '../mocks/alerts.json'
import ticketsMock from '../mocks/tickets.json'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
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

export const importCsv = (file, commit = false) => {
  if (USE_MOCK) {
    return mock({
      rows: 500,
      valid: 488,
      errors: [{ row: 12, problem: 'unknown entity_id B9' }],
      preview: [],
    })
  }
  const form = new FormData()
  form.append('file', file)
  return request(`/api/import/csv?commit=${commit}`, { method: 'POST', body: form })
}

export const getConnections = () =>
  USE_MOCK
    ? mock({
        nodes: [{ id: 'UT-SUB', type: 'substation' }, { id: 'B1', type: 'building' }],
        edges: [{ from: 'UT-SUB', to: 'B1', utility: 'electricity' }],
      })
    : request('/api/connections')

export const getImpact = (id) =>
  USE_MOCK
    ? mock({ id, affected: { rooms: 8, equipment: 31, ids: [] } })
    : request(`/api/connections/${id}/impact`)

// ---- Tickets & technicians ----
export const getTickets = (status) =>
  USE_MOCK
    ? mock(status ? ticketsMock.filter((t) => t.status === status) : ticketsMock)
    : request(`/api/tickets${qs({ status })}`)

export const createTicket = (body) =>
  USE_MOCK
    ? mock({ ...ticketsMock[0], ...body, id: 'TK-MOCK', source: 'manual' })
    : request('/api/tickets', json('POST', body))

export const updateTicket = (id, body) =>
  USE_MOCK
    ? mock({ ...ticketsMock.find((t) => t.id === id), ...body })
    : request(`/api/tickets/${id}`, json('PATCH', body))

export const completeTicket = (id, note, photo) => {
  if (USE_MOCK) return mock({ ...ticketsMock[0], id, status: 'done', verification: 'pending' })
  const form = new FormData()
  form.append('note', note)
  if (photo) form.append('photo', photo)
  return request(`/api/tickets/${id}/complete`, { method: 'POST', body: form })
}

export const getTechnicians = () =>
  USE_MOCK
    ? mock([
        { id: 'T-001', name: 'Suresh Patil', skill: 'mechanical', active_tickets: 1 },
        { id: 'T-002', name: 'Anita Rao', skill: 'electrical', active_tickets: 0 },
        { id: 'T-003', name: 'Ravi Kumar', skill: 'plumbing', active_tickets: 1 },
      ])
    : request('/api/technicians')

export const suggestTechnicians = (ticketId) =>
  USE_MOCK
    ? mock([{ id: 'T-002', name: 'Anita Rao', skill: 'electrical', active_tickets: 0, reason: 'Electrical skill, no active tickets' }])
    : request(`/api/technicians/suggest${qs({ ticket_id: ticketId })}`)

// ---- Insights (Aditya) ----
export const getAlerts = (active = true) =>
  USE_MOCK ? mock(alertsMock) : request(`/api/insights/alerts${qs({ active })}`)

export const runInsights = () =>
  USE_MOCK ? mock({ alerts_new: 0, tickets_created: 0, verified: 0 }) : request('/api/insights/run', { method: 'POST' })

export const injectFault = (entity_id, kind) =>
  USE_MOCK ? mock({ ok: true }) : request('/api/insights/sim/fault', json('POST', { entity_id, kind }))

export const getFaults = () => (USE_MOCK ? mock([]) : request('/api/insights/sim/faults'))

export const getInterventions = () => (USE_MOCK ? mock([]) : request('/api/insights/interventions'))

export const runWhatIf = (actions) =>
  USE_MOCK
    ? mock({ baseline: {}, scenario: {}, savings: {}, per_building: [] })
    : request('/api/insights/whatif', json('POST', { actions }))

export const getSustainabilityReport = (days = 30) =>
  USE_MOCK ? mock({}) : request(`/api/insights/reports/sustainability${qs({ days })}`)

export const getAssetHealthReport = () =>
  USE_MOCK ? mock({ buildings: [], worst_assets: [] }) : request('/api/insights/reports/asset-health')
