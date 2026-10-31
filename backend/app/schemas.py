"""Pydantic response models - the api.md shapes, and nothing else.

Kept in one file so the frontend's mock JSON and these can be diffed by eye.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

Status = Literal["ok", "warning", "critical", "offline"]


class Position(BaseModel):
    x: float
    z: float


class Size(BaseModel):
    w: float
    d: float


class BuildingCard(BaseModel):
    id: str
    name: str
    floors: int
    position: Position
    size: Size
    status: Status
    power_kw: float
    baseline_kw: float
    water_lpm: float
    occupancy: int
    active_alerts: int


class UtilityNode(BaseModel):
    id: str
    type: str
    position: Position


class CampusTotals(BaseModel):
    power_kw: float
    baseline_kw: float
    water_lpm: float
    occupancy: int
    active_alerts: int
    open_tickets: int


class Campus(BaseModel):
    buildings: list[BuildingCard]
    utilities: list[UtilityNode]
    totals: CampusTotals


class RoomSummary(BaseModel):
    id: str
    name: str
    room_type: str
    status: Status
    power_kw: float
    baseline_kw: float
    occupancy: int
    equipment_count: int


class FloorDetail(BaseModel):
    id: str
    level: int
    rooms: list[RoomSummary]


class BuildingDetail(BaseModel):
    id: str
    name: str
    floors: list[FloorDetail]


class EquipmentSummary(BaseModel):
    id: str
    name: str
    eq_type: str
    status: Status
    criticality: str
    power_kw: float
    health: Status


class RoomDetail(BaseModel):
    id: str
    name: str
    room_type: str
    status: Status
    equipment: list[EquipmentSummary]


class HistoryEntry(BaseModel):
    date: str
    action: str
    cost: int
    notes: str | None = None


class PredictionInfo(BaseModel):
    risk: float
    days_to_failure: int | None = None
    reasons: list[str] = []


class EquipmentDetail(BaseModel):
    id: str
    name: str
    eq_type: str
    room_id: str
    building_id: str
    rated_kw: float
    power_kw: float
    status: str
    criticality: str
    owner_dept: str | None = None
    owner_name: str | None = None
    install_date: str | None = None
    warranty_until: str | None = None
    warranty_days_left: int | None = None
    replacement_cost: int
    history: list[HistoryEntry]
    prediction: PredictionInfo | None = None
    open_ticket_id: str | None = None


class ReadingPoint(BaseModel):
    ts: datetime
    value: float
    baseline: float | None = None


class Band(BaseModel):
    low: float
    high: float


class ReadingsResponse(BaseModel):
    entity_id: str
    metric: str
    points: list[ReadingPoint]
    band: Band


class ConnectionNode(BaseModel):
    id: str
    type: str


class ConnectionEdge(BaseModel):
    from_: str
    to: str
    utility: str

    model_config = {"populate_by_name": True}


class ConnectionsResponse(BaseModel):
    nodes: list[ConnectionNode]
    edges: list[dict[str, str]]


class Affected(BaseModel):
    rooms: int
    equipment: int
    ids: list[str]


class ImpactResponse(BaseModel):
    id: str
    affected: Affected
