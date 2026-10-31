import { useCallback, useMemo, useState } from 'react'

export const EMPTY_SEL = { buildingId: null, floorId: null, roomId: null, equipmentId: null }

// Selection works controlled (parent passes `selection`) or uncontrolled (parent passes null:
// we keep our own state so the 3D view is usable on its own). Either way we call onSelect.
export function useSelection(selectionProp, onSelect) {
  const [internal, setInternal] = useState(EMPTY_SEL)
  const controlled = selectionProp != null
  const raw = controlled ? selectionProp : internal

  const { buildingId = null, floorId = null, roomId = null, equipmentId = null } = raw
  const selection = useMemo(
    () => ({ buildingId, floorId, roomId, equipmentId }),
    [buildingId, floorId, roomId, equipmentId]
  )

  const select = useCallback(
    (next) => {
      const full = { ...EMPTY_SEL, ...next }
      setInternal(full)
      onSelect?.(full)
    },
    [onSelect]
  )

  // One level up: equipment -> room -> building -> campus.
  const back = useCallback(() => {
    if (selection.equipmentId) select({ ...selection, equipmentId: null })
    else if (selection.roomId) select({ buildingId: selection.buildingId })
    else if (selection.buildingId) select(EMPTY_SEL)
  }, [selection, select])

  const reset = useCallback(() => select(EMPTY_SEL), [select])

  return { selection, select, back, reset }
}
