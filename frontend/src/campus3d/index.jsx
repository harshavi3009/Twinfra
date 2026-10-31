// PLACEHOLDER. This folder belongs to Rishi: replace this file with the real 3D scene.
// Props match the contract in contract/api.md ("Frontend <-> 3D component").
export function Campus3D({
  campus = null, // GET /api/campus
  buildingDetail = null, // GET /api/buildings/{id} for the selected building
  selection = null, // { buildingId, floorId, roomId, equipmentId }
  onSelect = () => {}, // same shape as selection
  connections = null, // optional, for flow lines
  highlightIds = [], // e.g. impact analysis results
  whatIf = null, // per_building from /api/insights/whatif
  timeOfDay = 'day', // 'day' | 'night'
}) {
  return (
    <div className="flex h-full min-h-64 w-full items-center justify-center rounded-lg border border-dashed border-line bg-panel/60 text-muted">
      <div className="text-center">
        <div className="text-lg font-semibold text-text">3D goes here</div>
        <div className="mt-1 font-mono text-xs">
          {campus ? `${campus.buildings.length} buildings` : 'no campus data'} · {timeOfDay}
          {selection?.buildingId ? ` · selected ${selection.buildingId}` : ''}
        </div>
      </div>
    </div>
  )
}

export default Campus3D
