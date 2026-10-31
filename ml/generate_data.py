"""Synthetic campus data generator for CampusTwin (HackNova 2026, PS12).

Writes one CSV per table into `data/`, with columns matching `contract/db.md`
exactly so Ayaan's seeder can load them directly.

ALL DATA IS SYNTHETIC.

Usage:
    python ml/generate_data.py                # write CSVs into data/
    python ml/generate_data.py --out /tmp/x   # write somewhere else
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

import config as C  # noqa: E402

rng = np.random.default_rng(C.SEED)

# ------------------------------------------------------------------ helpers


def _money(x: float, step: int = 500) -> int:
    """Round a rupee amount to something human."""
    return int(round(x / step) * step)


def _heat(hour: np.ndarray) -> np.ndarray:
    """Afternoon heat curve peaking ~15:00. 0..1."""
    return np.clip(np.sin(np.pi * (hour - 9) / 12), 0, None)


def _open_mask(hours: np.ndarray, open_h: int, close_h: int) -> np.ndarray:
    return ((hours >= open_h) & (hours < close_h)).astype(float)


# ------------------------------------------------------------------ campus


def build_campus():
    buildings, floors, rooms, equipment = [], [], [], []
    eq_counter = 1

    for bid, name, nfloors, x, z, w, d, open_t, close_t, days in C.BUILDINGS:
        buildings.append({
            "id": bid, "name": name, "floors": nfloors,
            "pos_x": x, "pos_z": z, "width": w, "depth": d,
            "open_time": open_t, "close_time": close_t, "open_days": days,
        })

        for level in range(1, nfloors + 1):
            fid = f"{bid}-F{level}"
            floors.append({"id": fid, "building_id": bid, "level": level})

            room_no = 0
            for room_type, count, kw_range, capacity in C.ROOM_MIX[bid]:
                for _ in range(count):
                    room_no += 1
                    rid = f"{fid}-R{room_no:02d}"
                    rooms.append({
                        "id": rid, "floor_id": fid, "building_id": bid,
                        "name": f"{room_type.replace('_', ' ').title()} {level}{room_no:02d}",
                        "room_type": room_type, "capacity": capacity,
                    })

                    for eq_type, eq_count, rated_range in C.EQUIPMENT_MIX[room_type]:
                        for _ in range(eq_count):
                            eid = f"EQ-{eq_counter:04d}"
                            eq_counter += 1
                            equipment.append(_make_equipment(
                                eid, rid, bid, eq_type, rated_range))

        # building-level utilities live in the ground floor's first office-ish room;
        # attach them to the floor-1 room list only for the FK, they act on the building.
        fid1 = f"{bid}-F1"
        for eq_type, eq_count, rated_range in C.BUILDING_EQUIPMENT:
            for _ in range(eq_count):
                eid = f"EQ-{eq_counter:04d}"
                eq_counter += 1
                equipment.append(_make_equipment(
                    eid, f"{fid1}-R01", bid, eq_type, rated_range))

    for eq_type, eq_count, rated_range in C.UTILITY_EQUIPMENT:
        for _ in range(eq_count):
            eid = f"EQ-{eq_counter:04d}"
            eq_counter += 1
            equipment.append({
                "id": eid, "room_id": None, "building_id": None, "name": "Substation Transformer 1",
                "eq_type": eq_type, "rated_kw": round(float(rng.uniform(*rated_range)), 2),
                "owner_dept": "Electrical", "owner_name": "Er. S. Bhosale",
                "install_date": "1998-04-01", "warranty_until": "2008-04-01",
                "criticality": "critical", "status": "running",
                "replacement_cost": 1_800_000,
                "age_days": 10_000,
            })

    return (pd.DataFrame(buildings), pd.DataFrame(floors),
            pd.DataFrame(rooms), pd.DataFrame(equipment))


def _make_equipment(eid, room_id, building_id, eq_type, rated_range):
    # install age: newer kit for IT, older for mech
    if eq_type in ("server_rack", "computers"):
        age_days = int(rng.integers(200, 1500))
    elif eq_type == "transformer":
        age_days = int(rng.integers(3000, 9000))
    else:
        age_days = int(rng.integers(300, 2800))

    install = datetime.now().date() - timedelta(days=age_days)
    warranty_years = 4 if eq_type in ("server_rack", "computers", "lift") else 5
    warranty = install + timedelta(days=365 * warranty_years)
    rated = round(float(rng.uniform(*rated_range)), 2)
    replacement = {"server_rack": 220_000, "transformer": 1_800_000, "lift": 900_000,
                   "lathe": 450_000, "pump": 60_000, "ac": 45_000,
                   "computers": 80_000, "lighting": 6_000,
                   "water_cooler": 18_000}[eq_type]
    return {
        "id": eid, "room_id": room_id, "building_id": building_id,
        "name": f"{eq_type.replace('_', ' ').title()} {eid[-2:]}",
        "eq_type": eq_type, "rated_kw": rated,
        "owner_dept": C.OWNER_DEPTS[int(rng.integers(0, len(C.OWNER_DEPTS)))],
        "owner_name": f"Prof. {['X','Y','Z','A','B','C'][int(rng.integers(0, 6))]}",
        "install_date": install.isoformat(),
        "warranty_until": warranty.isoformat(),
        "criticality": C.CRITICALITY_BY_TYPE[eq_type],
        "status": "running",
        "replacement_cost": replacement,
        "age_days": age_days,
    }


def build_connections(buildings, floors, equipment):
    rows, sid = [], 1

    def add(a, b, utility):
        nonlocal sid
        rows.append({"id": sid, "from_id": a, "to_id": b, "utility": utility})
        sid += 1

    for bid, *_ in C.BUILDINGS:
        add("UT-SUB", bid, "electricity")
        add("UT-TANK", bid, "water")

    for fid in floors["id"]:
        bid = fid.split("-")[0]
        add(bid, fid, "electricity")

    for _, eq in equipment.iterrows():
        if eq["building_id"] is None:
            add("UT-SUB", eq["id"], "electricity")
            continue
        add(eq["room_id"], eq["id"], "electricity")

    return pd.DataFrame(rows)


# ------------------------------------------------------------ technicians


def build_technicians():
    return pd.DataFrame(
        [{"id": i, "name": n, "skill": s, "phone": f"9{rng.integers(10**8, 10**9)}",
          "active_tickets": 0} for i, n, s in C.TECHNICIANS]
    )


def build_maintenance_log(equipment, technicians):
    """A year of history, ~1-4 service events per asset, plus planted stories."""
    rows, mid = [], 1
    actions = ["service", "repair", "part_replaced", "inspection"]
    skills = technicians["skill"].tolist()

    for _, eq in equipment.iterrows():
        n_events = int(rng.integers(1, 5))
        for _ in range(n_events):
            days_ago = int(rng.integers(1, 365))
            rows.append({
                "id": mid, "equipment_id": eq["id"],
                "date": (datetime.now().date() - timedelta(days=days_ago)).isoformat(),
                "action": actions[int(rng.integers(0, len(actions)))],
                "cost": _money(float(rng.uniform(500, 9000))),
                "technician_id": C.TECHNICIANS[int(rng.integers(0, len(skills)))][0],
                "notes": "routine",
            })
            mid += 1
    return pd.DataFrame(rows), mid, skills


# --------------------------------------------------------------- readings


def _hour_index(now: datetime, days: int):
    start = (now - timedelta(days=days)).replace(minute=0, second=0, microsecond=0)
    return pd.date_range(start, now.replace(minute=0, second=0, microsecond=0), freq="h")


def _occupancy_curve(hours, weekdays, open_h, close_h, capacity, is_hostel):
    if is_hostel:
        base = np.where((hours >= 21) | (hours < 7), 0.85, 0.25)
    else:
        base = _open_mask(hours, open_h, close_h) * np.where(hours < 13, 0.9, 0.75)
        base = base * (1 - 0.85 * (weekdays == 6))          # Sunday dip
    return np.clip(base * capacity * rng.normal(1.0, 0.08, len(hours)), 0, capacity)


def build_readings(buildings, rooms, equipment, now):
    idx = _hour_index(now, C.HISTORY_DAYS)
    hours = idx.hour.to_numpy()
    weekdays = idx.day_of_week.to_numpy()
    heat = _heat(hours)
    is_night = ((hours >= 22) | (hours < 6)).astype(float)

    rows = []

    def push(ts, entity_id, metric, value, source="sim"):
        rows.append({"ts": ts.isoformat(), "entity_id": entity_id,
                     "metric": metric, "value": round(float(max(value, 0)), 3),
                     "source": source})

    open_map = {b["id"]: h for b, h in
                [({"id": bid}, int(open_t.split(":")[0])) for bid, _, _, _, _, _, _, open_t, _, _ in C.BUILDINGS]}
    close_map = {bid: int(close_t.split(":")[0])
                 for bid, _, _, _, _, _, _, _, close_t, _ in C.BUILDINGS}

    building_power = {b: np.zeros(len(idx)) for b in buildings["id"]}
    building_occ = {b: np.zeros(len(idx)) for b in buildings["id"]}

    # ---- rooms
    for _, room in rooms.iterrows():
        bid, rid, rtype = room["building_id"], room["id"], room["room_type"]
        cap = int(room["capacity"])
        is_hostel = rtype == "hostel_room"
        occ = _occupancy_curve(hours, weekdays, open_map[bid], close_map[bid], cap, is_hostel)
        occ = np.round(occ)

        base_kw = {"classroom": 1.6, "lab": 7.0, "office": 1.2, "workshop": 12.0,
                   "library_hall": 3.0, "hostel_room": 0.6, "server_room": 6.5}[rtype]
        if rtype == "lab":
            # lab computers follow a timetable: not every hour has a class
            timetable = (rng.random(len(idx)) > 0.35).astype(float)
            occupancy_frac = np.clip(occ / max(cap, 1), 0, 1) * timetable
        elif rtype == "server_room":
            occupancy_frac = np.ones(len(idx))
        else:
            occupancy_frac = np.clip(occ / max(cap, 1), 0, 1)

        power = base_kw * (0.15 + 0.85 * occupancy_frac)
        # AC load follows afternoon heat
        power = power * (1 + 0.35 * heat)
        power = power * rng.normal(1.0, C.SIM_NOISE, len(idx))
        if rtype == "server_room":
            power = power * (1 + 0.02 * np.arange(len(idx)) / max(len(idx), 1))

        water = np.where(occ > 0, occ * 0.02 * rng.normal(1.0, 0.1, len(idx)), 0.0)
        water = np.where((rtype == "workshop") & (occ > 0), occ * 0.15, water)

        for i, ts in enumerate(idx):
            push(ts, rid, "power_kw", power[i])
            push(ts, rid, "occupancy", occ[i])
            push(ts, rid, "water_lpm", water[i])

        building_power[bid] += power
        building_occ[bid] += occ

    # ---- equipment (power only, key types)
    equip_power = {}
    for _, eq in equipment.iterrows():
        if eq["eq_type"] not in ("ac", "computers", "server_rack", "lathe", "pump",
                                 "transformer", "lift"):
            continue
        rated = float(eq["rated_kw"])
        if eq["room_id"] is None:  # transformer = everything
            p = np.zeros(len(idx))
            for b in building_power:
                p += building_power[b]
            p = p * 0.95
        elif eq["eq_type"] in ("ac",):
            p = rated * (0.1 + 0.9 * heat) * rng.normal(1.0, 0.08, len(idx))
        elif eq["eq_type"] in ("lift", "pump"):
            hrs_l = open_map.get(eq["building_id"] or "B1", 9)
            p = rated * _open_mask(hours, hrs_l, hrs_l + 9) * rng.uniform(0.2, 0.7, len(idx))
        else:
            p = rated * rng.uniform(0.4, 0.8, len(idx)) * rng.normal(1.0, 0.06, len(idx))
        equip_power[eq["id"]] = p
        for i, ts in enumerate(idx):
            push(ts, eq["id"], "power_kw", p[i])

    # ---- buildings (sum of rooms, so panels agree)
    for bid in buildings["id"]:
        unopen = _open_mask(hours, open_map[bid], close_map[bid])
        water = building_occ[bid] * 0.02 * rng.normal(1.0, 0.1, len(idx))
        for i, ts in enumerate(idx):
            push(ts, bid, "power_kw", building_power[bid][i])
            push(ts, bid, "occupancy", building_occ[bid][i])
            push(ts, bid, "water_lpm", water[i])

    df = pd.DataFrame(rows)
    return df, idx, building_power, equip_power, (open_map, close_map)


# ------------------------------------------------------------ planted stories


def plant_stories(readings, rooms, equipment, idx, building_power, equip_power, openmap):
    """Bend the generated data so the ML has something real to discover."""
    open_map, close_map = openmap
    df = readings
    notes = []
    # hour per reading row, aligned by position (readings are emitted in ts order per entity)
    n_hours = len(idx)
    df = df.reset_index(drop=True)
    df["_h"] = idx.hour.to_numpy()[np.arange(len(df)) % n_hours]
    night = df["_h"].isin([0, 1, 2, 3, 4]).to_numpy()

    # 1. ghost load: a B2 lab with ACs + lights on at 0-5 am, nobody inside
    labs_b2 = rooms[(rooms["building_id"] == "B2") & (rooms["room_type"] == "lab")]
    ghost = labs_b2.iloc[0]["id"]
    mask = (df["entity_id"] == ghost) & (df["metric"] == "power_kw") & night
    df.loc[mask, "value"] = df.loc[mask, "value"] + 4.2
    mask_occ = (df["entity_id"] == ghost) & (df["metric"] == "occupancy") & night
    df.loc[mask_occ, "value"] = 0
    notes.append(f"ghost_load: {ghost} draws ~4.2 kW at 00:00-05:00 with 0 occupancy")

    # 2. hostel night leak: steady water 02:00-04:00
    hostel_rooms = rooms[rooms["room_type"] == "hostel_room"].iloc[:3]["id"].tolist()
    leak_hours = df["_h"].isin([2, 3]).to_numpy()
    for r in hostel_rooms:
        m = (df["entity_id"] == r) & (df["metric"] == "water_lpm") & leak_hours
        df.loc[m, "value"] = df.loc[m, "value"] + 1.8
    hb = rooms[rooms["room_type"] == "hostel_room"].iloc[0]["building_id"]
    m = (df["entity_id"] == hb) & (df["metric"] == "water_lpm") & leak_hours
    df.loc[m, "value"] = df.loc[m, "value"] + 5.4
    notes.append(f"night_leak: {hb} water +5.4 lpm at 02:00-04:00 (synthetic leak)")

    # 3. ageing transformer: rising load trend (handled in equipment loop)
    transformer = equipment[equipment["eq_type"] == "transformer"].iloc[0]["id"]
    m = (df["entity_id"] == transformer) & (df["metric"] == "power_kw")
    trend = np.linspace(0, 0.06, m.sum())
    df.loc[m, "value"] = df.loc[m, "value"].to_numpy() * (1 + trend)
    notes.append(f"drift: {transformer} load rising ~6% across 14 days")

    # 4. bad AC: sits in B1, will get 3 repairs in 6 months + warranty in ~2 weeks
    bad_ac = equipment[(equipment["eq_type"] == "ac") &
                       (equipment["building_id"] == "B1")].iloc[0]["id"]
    notes.append(f"story: {bad_ac} = 3 repairs in 6 months, warranty ends in ~2 weeks")

    df = df.drop(columns=["_h"])
    return df, notes, {"ghost_entity": ghost, "leak_building": hb,
                       "transformer": transformer, "bad_ac": bad_ac}


def write_bad_ac_story(equipment, maintenance, next_id):
    """Give the planted AC its 3 repairs, its short warranty, and a high runtime."""
    bad = equipment[equipment["eq_type"] == "ac"].iloc[0]
    return bad


# ------------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(C.DATA_DIR))
    ap.add_argument("--now", default=None, help="ISO timestamp for 'now' (default: real now)")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    now = datetime.fromisoformat(args.now) if args.now else datetime.now()

    buildings, floors, rooms, equipment = build_campus()
    connections = build_connections(buildings, floors, equipment)
    technicians = build_technicians()
    maintenance, next_mid, _ = build_maintenance_log(equipment, technicians)

    readings, idx, bpower, epower, openmap = build_readings(
        buildings, rooms, equipment, now)
    readings, notes, planted = plant_stories(
        readings, rooms, equipment, idx, bpower, epower, openmap)

    # --- apply the bad-AC story to equipment + maintenance history
    bad_ac = planted["bad_ac"]
    equipment.loc[equipment["id"] == bad_ac, "warranty_until"] = (
        now.date() + timedelta(days=14)).isoformat()
    eq_mask = equipment["id"] == bad_ac
    room_of_bad = equipment.loc[eq_mask, "room_id"].iloc[0]
    if isinstance(room_of_bad, str):
        equipment.loc[eq_mask, "room_id"] = room_of_bad  # unchanged

    for days_ago in (170, 95, 30):
        maintenance = pd.concat([maintenance, pd.DataFrame([{
            "id": next_mid, "equipment_id": bad_ac,
            "date": (now.date() - timedelta(days=days_ago)).isoformat(),
            "action": "repair", "cost": _money(rng.uniform(3000, 6000)),
            "technician_id": "T-002", "notes": "compressor",
        }])], ignore_index=True)
        next_mid += 1

    # ---------------- write
    files = {
        "buildings.csv": buildings,
        "floors.csv": floors,
        "rooms.csv": rooms,
        "equipment.csv": equipment.drop(columns=["age_days"]),
        "connections.csv": connections,
        "technicians.csv": technicians,
        "maintenance_log.csv": maintenance.sort_values("date"),
        "readings.csv": readings,
    }
    for name, df in files.items():
        df.to_csv(out / name, index=False)

    # keep the planted-equipment age for the prediction model
    equipment.drop(columns=["age_days"]).to_csv(out / "equipment.csv", index=False)

    print("=" * 68)
    print("CampusTwin synthetic data  (ALL DATA IS SYNTHETIC)")
    print("=" * 68)
    for name, df in files.items():
        size_kb = (out / name).stat().st_size / 1024
        print(f"  {name:<22} {len(df):>8,} rows  {size_kb:>9.1f} KB")
    print(f"\n  window : {idx[0]}  ->  {idx[-1]}  ({len(idx)} hourly points)")
    print(f"  campus : {len(buildings)} buildings, {len(rooms)} rooms, {len(equipment)} equipment")
    print("\n  planted stories for the ML to find:")
    for n in notes:
        print(f"   - {n}")
    print("\n  send these file names to Ayaan: " + ", ".join(files))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
