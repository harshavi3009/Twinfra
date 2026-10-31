// Dev-only stand-in for GET /api/campus (exact contract shape, 6 buildings from docs/contract/db.md).
// Use until Harshavi's frontend/src/mocks/ is available. All values are synthetic.
export const mockCampus = {
  buildings: [
    { id: 'B1', name: 'Main Academic Block', floors: 3, position: { x: 0, z: 0 }, size: { w: 40, d: 16 },
      status: 'warning', power_kw: 182.4, baseline_kw: 150.0, water_lpm: 40.2, occupancy: 420, active_alerts: 2 },
    { id: 'B2', name: 'Computer & IT Block', floors: 3, position: { x: 30, z: 30 }, size: { w: 24, d: 16 },
      status: 'critical', power_kw: 121.7, baseline_kw: 80.0, water_lpm: 22.0, occupancy: 260, active_alerts: 3 },
    { id: 'B3', name: 'Mechanical Workshop', floors: 1, position: { x: -35, z: 25 }, size: { w: 30, d: 14 },
      status: 'ok', power_kw: 64.3, baseline_kw: 70.0, water_lpm: 18.5, occupancy: 90, active_alerts: 0 },
    { id: 'B4', name: 'Library', floors: 2, position: { x: -30, z: -25 }, size: { w: 20, d: 20 },
      status: 'ok', power_kw: 38.9, baseline_kw: 42.0, water_lpm: 8.1, occupancy: 140, active_alerts: 0 },
    { id: 'B5', name: 'Hostel', floors: 4, position: { x: 35, z: -30 }, size: { w: 18, d: 28 },
      status: 'offline', power_kw: 0, baseline_kw: 95.0, water_lpm: 0, occupancy: 0, active_alerts: 1 },
    { id: 'B6', name: 'Admin Block', floors: 2, position: { x: 0, z: 40 }, size: { w: 22, d: 12 },
      status: 'ok', power_kw: 33.1, baseline_kw: 35.0, water_lpm: 6.4, occupancy: 60, active_alerts: 0 },
  ],
  utilities: [
    { id: 'UT-SUB', type: 'substation', position: { x: -50, z: 0 } },
    { id: 'UT-TANK', type: 'water_tank', position: { x: 50, z: 0 } },
  ],
  totals: { power_kw: 440.4, baseline_kw: 472.0, water_lpm: 95.2, occupancy: 970, active_alerts: 6, open_tickets: 3 },
}
