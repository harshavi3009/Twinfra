"""Every table from contract/db.md, plus one add-only column:

  readings.baseline  - the typical value for that weekday+hour (double precision).
                       api.md requires GET /api/readings to return per-point
                       "baseline" and a {low, high} band, but db.md has no table
                       for it. Add-only column keeps one table and one contract.
                       Nullable, so Aditya's simulator can write it or not.

IDs are human-readable strings (B1, B1-F2, B1-F2-R03, EQ-0042, T-007, TK-0001)
because that makes demos and debugging easy.
"""

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


# --------------------------------------------------------------------------- #
# Asset hierarchy
# --------------------------------------------------------------------------- #
class Building(Base):
    __tablename__ = "buildings"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    floors: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    pos_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    pos_z: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    width: Mapped[float] = mapped_column(Float, nullable=False, default=20.0)
    depth: Mapped[float] = mapped_column(Float, nullable=False, default=20.0)
    open_time: Mapped[Time | None] = mapped_column(Time, nullable=True)
    close_time: Mapped[Time | None] = mapped_column(Time, nullable=True)
    open_days: Mapped[str | None] = mapped_column(String(32), nullable=True)  # "Mon-Sat"

    floor_rows: Mapped[list["Floor"]] = relationship(
        back_populates="building", cascade="all, delete-orphan"
    )


class Floor(Base):
    __tablename__ = "floors"

    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    building_id: Mapped[str] = mapped_column(
        ForeignKey("buildings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    level: Mapped[int] = mapped_column(Integer, nullable=False)

    building: Mapped[Building] = relationship(back_populates="floor_rows")
    room_rows: Mapped[list["Room"]] = relationship(
        back_populates="floor", cascade="all, delete-orphan"
    )


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    floor_id: Mapped[str] = mapped_column(
        ForeignKey("floors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    building_id: Mapped[str] = mapped_column(
        ForeignKey("buildings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    # classroom | lab | office | workshop | hostel_room | library_hall | server_room
    room_type: Mapped[str] = mapped_column(String(32), nullable=False, default="classroom")
    capacity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    floor: Mapped[Floor] = relationship(back_populates="room_rows")
    equipment_rows: Mapped[list["Equipment"]] = relationship(
        back_populates="room", cascade="all, delete-orphan"
    )


class Equipment(Base):
    __tablename__ = "equipment"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    room_id: Mapped[str] = mapped_column(
        ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    building_id: Mapped[str] = mapped_column(
        ForeignKey("buildings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    # ac | lighting | computers | pump | transformer | lathe | water_cooler | lift | server_rack
    eq_type: Mapped[str] = mapped_column(String(32), nullable=False)
    rated_kw: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    owner_dept: Mapped[str | None] = mapped_column(String(64), nullable=True)
    owner_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    install_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    warranty_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    # critical | high | medium | low
    criticality: Mapped[str] = mapped_column(String(16), nullable=False, default="medium")
    # running | idle | fault | maintenance  (NOTE: not the ok/warning/critical enum;
    # that one is computed, see routers/health.py)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="running")
    replacement_cost: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    room: Mapped[Room] = relationship(back_populates="equipment_rows")
    maintenance_rows: Mapped[list["MaintenanceLog"]] = relationship(
        back_populates="equipment", cascade="all, delete-orphan"
    )


class Connection(Base):
    """Utility tree: UT-SUB -> B* -> floor -> equipment (electricity | water)."""

    __tablename__ = "connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    from_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    to_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    utility: Mapped[str] = mapped_column(String(16), nullable=False, default="electricity")


# --------------------------------------------------------------------------- #
# Time series
# --------------------------------------------------------------------------- #
class Reading(Base):
    __tablename__ = "readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(32), nullable=False)
    metric: Mapped[str] = mapped_column(String(24), nullable=False)  # power_kw | water_lpm | occupancy
    value: Mapped[float] = mapped_column(Float, nullable=False)
    source: Mapped[str | None] = mapped_column(String(8), nullable=True)  # csv | sim
    # Add-only: typical value for this weekday+hour. Drives the api.md baseline/band.
    baseline: Mapped[float | None] = mapped_column(Float, nullable=True)

    __table_args__ = (
        Index("ix_readings_entity_metric_ts", "entity_id", "metric", "ts"),
    )


# --------------------------------------------------------------------------- #
# Maintenance & workforce
# --------------------------------------------------------------------------- #
class MaintenanceLog(Base):
    __tablename__ = "maintenance_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    equipment_id: Mapped[str] = mapped_column(
        ForeignKey("equipment.id", ondelete="CASCADE"), nullable=False, index=True
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    action: Mapped[str] = mapped_column(String(24), nullable=False)  # service|repair|part_replaced|inspection
    cost: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    technician_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    equipment: Mapped[Equipment] = relationship(back_populates="maintenance_rows")


class Technician(Base):
    __tablename__ = "technicians"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    # electrical | hvac | plumbing | mechanical | it
    skill: Mapped[str] = mapped_column(String(24), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    active_tickets: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    entity_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    equipment_id: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")  # auto | manual
    priority: Mapped[str] = mapped_column(String(16), nullable=False, default="medium")
    # open | assigned | in_progress | done | closed
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open", index=True)
    technician_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    sla_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    escalated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completion_photo: Mapped[str | None] = mapped_column(String(255), nullable=True)
    completion_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # none | pending | verified | failed
    verification: Mapped[str] = mapped_column(String(16), nullable=False, default="none")
    evidence: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


# --------------------------------------------------------------------------- #
# Insights (written by Aditya's code)
# --------------------------------------------------------------------------- #
class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    entity_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    metric: Mapped[str | None] = mapped_column(String(24), nullable=True)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)  # spike|ghost_load|night_leak|drift
    actual: Mapped[float | None] = mapped_column(Float, nullable=True)
    expected: Mapped[float | None] = mapped_column(Float, nullable=True)
    ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="medium")
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    est_cost_inr_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    ticket_id: Mapped[str | None] = mapped_column(String(16), nullable=True)


class Prediction(Base):
    __tablename__ = "predictions"

    equipment_id: Mapped[str] = mapped_column(
        ForeignKey("equipment.id", ondelete="CASCADE"), primary_key=True
    )
    risk: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)  # 0..1
    days_to_failure: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reasons: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # list[str]
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
