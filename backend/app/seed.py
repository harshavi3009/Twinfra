"""Seed the pinned campus from contract/db.md.

Run:  python -m app.seed

Idempotent: safe to run repeatedly (upserts by id).
Later, `python -m app.seed --from-csv` will load Aditya's CSVs from data/
instead of the hand-made rows at the bottom of this file.
"""

import argparse
import csv
import random
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .db import SessionLocal
from .models import (
    Building,
    Connection,
    Equipment,
    Floor,
    MaintenanceLog,
    Reading,
    Room,
    Technician,
)

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"

# contract/db.md: id, name, floors, x, z, w, d
BUILDINGS = [
    ("B1", "Main Academic Block", 3, 0, 0, 40, 16),
    ("B2", "Computer & IT Block", 3, 30, 30, 24, 16),
    ("B3", "Mechanical Workshop", 1, -35, 25, 30, 14),
    ("B4", "Library", 2, -30, -25, 20, 20),
    ("B5", "Hostel", 4, 35, -30, 18, 28),
    ("B6", "Admin Block", 2, 0, 40, 22, 12),
]

UTILITIES = [("UT-SUB", "substation", -50, 0), ("UT-TANK", "water tank", 50, 0)]

# room_type per building, cycled across its rooms
ROOM_MIX = {
    "B1": ["classroom", "lab", "office"],
    "B2": ["lab", "server_room", "classroom"],
    "B3": ["workshop"],
    "B4": ["library_hall", "office"],
    "B5": ["hostel_room"],
    "B6": ["office"],
}

EQ_MIX = {
    "classroom": [("ac", 2.2, "hvac"), ("lighting", 0.6, "electrical")],
    "lab": [("ac", 2.2, "hvac"), ("computers", 4.0, "it"), ("lighting", 0.8, "electrical")],
    "office": [("ac", 1.6, "hvac"), ("computers", 1.2, "it"), ("lighting", 0.4, "electrical")],
    "workshop": [("lathe", 7.5, "mechanical"), ("lighting", 1.2, "electrical")],
    "library_hall": [("ac", 3.5, "hvac"), ("lighting", 1.5, "electrical")],
    "hostel_room": [("ac", 1.2, "hvac"), ("water_cooler", 0.9, "plumbing")],
    "server_room": [("ac", 5.5, "hvac"), ("server_rack", 6.0, "it")],
}


def build_universe():
    """Pure-Python expansion of the campus: buildings/rooms/equipment.

    Aditya's simulator imports this so his generator and this seed agree on
    the exact same entity ids.
    """
    buildings = [
        dict(id=b, name=n, floors=f, pos_x=x, pos_z=z, width=w, depth=d)
        for b, n, f, x, z, w, d in BUILDINGS
    ]

    rooms, equipment = [], []
    eq_no = 1
    for b, _n, nfloors, *_rest in BUILDINGS:
        mix = ROOM_MIX[b]
        for level in range(1, nfloors + 1):
            rooms_this_floor = 6 if b != "B3" else 4
            for i in range(1, rooms_this_floor + 1):
                rtype = mix[(i - 1) % len(mix)]
                rid = f"{b}-F{level}-R{i:02d}"
                rooms.append(
                    dict(
                        id=rid,
                        floor_id=f"{b}-F{level}",
                        building_id=b,
                        name=f"{rtype.replace('_', ' ').title()} {level}{i:02d}",
                        room_type=rtype,
                        capacity=40 if rtype in ("classroom", "library_hall") else 20,
                    )
                )
                for eq_type, rated, _skill in EQ_MIX[rtype]:
                    eid = f"EQ-{eq_no:04d}"
                    eq_no += 1
                    equipment.append(
                        dict(
                            id=eid,
                            room_id=rid,
                            building_id=b,
                            name=f"{eq_type.replace('_', ' ').title()} {eid[-3:]}",
                            eq_type=eq_type,
                            rated_kw=rated,
                            owner_dept="Estates",
                            owner_name="Facility Office",
                            install_date=date(2021, 6, 1) + timedelta(days=eq_no * 13),
                            warranty_until=date(2026, 11, 12) - timedelta(days=eq_no % 400),
                            criticality=(
                                "critical" if eq_type in ("server_rack", "transformer")
                                else "high" if eq_type in ("ac", "lathe", "lift")
                                else "medium" if eq_type in ("computers", "pump")
                                else "low"
                            ),
                            status="running",
                            replacement_cost=45000 if eq_type == "ac" else 15000,
                        )
                    )
    return buildings, rooms, equipment


def build_connections(buildings, rooms, equipment):
    """Utility tree: UT-SUB -> building -> floor -> equipment."""
    edges = []
    for b in buildings:
        edges.append(("UT-SUB", b["id"], "electricity"))
        edges.append(("UT-TANK", b["id"], "water"))
    for fid in sorted({r["floor_id"] for r in rooms}):
        edges.append((fid.split("-")[0], fid, "electricity"))
    for r in rooms:
        edges.append((r["floor_id"], r["id"], "electricity"))
    for e in equipment:
        edges.append((e["room_id"], e["id"], "electricity"))
    return edges


def seed_campus(db) -> None:
    buildings, rooms, equipment = build_universe()

    def upsert(model, rows, conflict_col):
        if not rows:
            return
        stmt = pg_insert(model).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=[conflict_col],
            set_={k: stmt.excluded[k] for k in rows[0] if k != conflict_col},
        )
        db.execute(stmt)

    upsert(Building, buildings, "id")
    floor_ids = sorted({r["floor_id"] for r in rooms})
    upsert(
        Floor,
        [{"id": fid, "building_id": fid.split("-F")[0],
          "level": int(fid.split("-F")[1])} for fid in floor_ids],
        "id",
    )
    upsert(Room, rooms, "id")
    upsert(Equipment, equipment, "id")

    db.execute(delete(Connection))
    db.execute(
        pg_insert(Connection).values(
            [{"from_id": f, "to_id": t, "utility": u} for f, t, u in
             build_connections(buildings, rooms, equipment)]
        )
    )

    print(f"campus: {len(buildings)} buildings, "
          f"{len({r['floor_id'] for r in rooms})} floors, "
          f"{len(rooms)} rooms, {len(equipment)} equipment")


def seed_workforce(db) -> None:
    techs = [
        ("T-001", "Ravi Kumar", "hvac", "+91-90000-00001"),
        ("T-002", "Sana Iqbal", "electrical", "+91-90000-00002"),
        ("T-003", "Mohan Das", "plumbing", "+91-90000-00003"),
        ("T-004", "Priya Nair", "it", "+91-90000-00004"),
        ("T-005", "Arjun Rao", "mechanical", "+91-90000-00005"),
    ]
    rows = [dict(id=i, name=n, skill=s, phone=p, active_tickets=0) for i, n, s, p in techs]
    stmt = pg_insert(Technician).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["id"],
        set_={k: stmt.excluded[k] for k in rows[0] if k != "id"},
    )
    db.execute(stmt)
    print(f"technicians: {len(rows)}")


def seed_readings(db, buildings, hours: int = 24, step_min: int = 15) -> None:
    """Hand-made readings so the API is testable before Aditya's CSVs land.

    Writes both `value` and `baseline`. Building-level power is the sum of a
    simple schedule shape; occupancy follows class hours.
    """
    rng = random.Random(42)
    db.execute(delete(Reading).where(Reading.source == "sim"))
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = now - timedelta(hours=hours)
    rows = []
    n_steps = int(hours * 60 / step_min)
    for b in buildings:
        for i in range(n_steps):
            ts = start + timedelta(minutes=i * step_min)
            h = ts.hour + ts.minute / 60
            base = 150.0 if b["id"] == "B1" else 60.0
            shape = 0.35 if h < 8 else 0.9 if 9 <= h <= 17 else 0.55 if h <= 20 else 0.2
            occ_shape = 0 if h < 8 else 1.0 if 9 <= h <= 17 else 0.4 if h <= 20 else 0
            for metric, val, bl in (
                ("power_kw", base * shape, base * shape),
                ("water_lpm", 40.0 * occ_shape, 40.0 * occ_shape),
                ("occupancy", 420 * occ_shape, 420 * occ_shape),
            ):
                rows.append(
                    dict(
                        ts=ts,
                        entity_id=b["id"],
                        metric=metric,
                        value=round(val * rng.uniform(0.93, 1.07), 3),
                        baseline=round(bl, 3),
                        source="sim",
                    )
                )
    db.execute(pg_insert(Reading), rows)
    print(f"readings: {len(rows)} rows ({hours}h of 15-min data for {len(buildings)} buildings)")


def seed_csv(db) -> None:
    """Load Aditya's CSVs from data/ if present (columns == table columns)."""
    files = {
        "buildings.csv": None, "floors.csv": None, "rooms.csv": None,
        "equipment.csv": None, "readings.csv": None, "maintenance_log.csv": None,
    }
    loaded = 0
    for csv_name in files:
        path = DATA_DIR / csv_name
        if not path.exists():
            continue
        with path.open(newline="", encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))
        if not rows:
            continue
        func = globals().get(f"_csv_{csv_name.replace('.csv', '')}")
        if func is None:
            print(f"  ! {csv_name}: no loader yet, skipped")
            continue
        loaded += func(db, rows)
        print(f"  {csv_name}: {len(rows)} rows")
    if loaded == 0:
        print("  no CSVs found in data/ - seeded hand-made rows instead")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-csv", action="store_true",
                    help="also load CSVs from data/ (Aditya's generator)")
    ap.add_argument("--no-readings", action="store_true", help="skip reading seed")
    ap.add_argument("--reset", action="store_true", help="delete tickets/alerts first")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        if args.reset:
            from .models import Alert, Prediction, Ticket
            db.query(Alert).delete()
            db.query(Prediction).delete()
            db.query(Ticket).delete()
            db.flush()

        seed_campus(db)
        seed_workforce(db)
        if args.from_csv:
            seed_csv(db)
        elif not args.no_readings:
            buildings, _rooms, _eq = build_universe()
            seed_readings(db, buildings, hours=24)
        db.commit()
        print("done.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
