"""Live campus simulator + fault injection (D2).

Every tick it generates the current hour's readings for every room / building /
key equipment using the same patterns as `ml/generate_data.py`, applies any
injected faults, and pushes them to the backend. Every N ticks it asks the
backend to run detection.

Usage:
    python ml/simulator.py                 # default: http://localhost:8000
    python ml/simulator.py --speed 5       # 5 simulated hours per tick
    python ml/simulator.py --dry-run       # print, don't POST
    python ml/simulator.py --once          # one tick then exit (for testing)
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))

import config as C  # noqa: E402

BATCH_CHUNK = 2000      # rows per POST, keeps requests small


# ------------------------------------------------------------------ campus


def load_campus(data_dir: Path):
    need = ["buildings.csv", "rooms.csv", "equipment.csv"]
    missing = [f for f in need if not (data_dir / f).exists()]
    if missing:
        raise SystemExit(
            f"missing {missing} in {data_dir}. Run: python ml/generate_data.py"
        )
    buildings = pd.read_csv(data_dir / "buildings.csv")
    rooms = pd.read_csv(data_dir / "rooms.csv")
    equipment = pd.read_csv(data_dir / "equipment.csv")
    return buildings, rooms, equipment


def _hour(open_time: str, close_time: str) -> tuple[int, int]:
    return int(str(open_time).split(":")[0]), int(str(close_time).split(":")[0])


# ------------------------------------------------------------------ patterns


def room_readings(rooms, buildings, ts: datetime, rng) -> pd.DataFrame:
    """power_kw, occupancy, water_lpm for every room at one timestamp."""
    hour, weekday = ts.hour, ts.weekday()
    heat = max(0.0, float(np.sin(np.pi * (hour - 9) / 12))) if 9 <= hour <= 21 else 0.0

    bmap = {row["id"]: row for _, row in buildings.iterrows()}
    rows = []

    for _, room in rooms.iterrows():
        bid, rid, rtype = room["building_id"], room["id"], room["room_type"]
        cap = int(room["capacity"])
        b = bmap.get(bid)
        open_h, close_h = _hour(b["open_time"], b["close_time"]) if b is not None else (8, 18)

        if rtype == "hostel_room":
            frac = 0.85 if (hour >= 21 or hour < 7) else 0.25
        elif rtype == "server_room":
            frac = 1.0
        else:
            frac = 0.0
            if open_h <= hour < close_h:
                frac = 0.9 if hour < 13 else 0.75
            if weekday == 6:               # Sunday dip
                frac *= 0.15

        frac *= float(rng.normal(1.0, 0.08))
        frac = float(np.clip(frac, 0.0, 1.0))
        occ = round(frac * cap)

        base_kw = {"classroom": 1.6, "lab": 7.0, "office": 1.2, "workshop": 12.0,
                   "library_hall": 3.0, "hostel_room": 0.6, "server_room": 6.5}[rtype]
        power = base_kw * (0.15 + 0.85 * frac) * (1 + 0.35 * heat)
        power *= float(rng.normal(1.0, C.SIM_NOISE))

        water = occ * 0.02 * float(rng.normal(1.0, 0.1))
        if rtype == "workshop":
            water = occ * 0.15

        rows.append({"ts": ts, "entity_id": rid, "metric": "power_kw", "value": max(power, 0)})
        rows.append({"ts": ts, "entity_id": rid, "metric": "occupancy", "value": occ})
        rows.append({"ts": ts, "entity_id": rid, "metric": "water_lpm", "value": max(water, 0)})

    return pd.DataFrame(rows)


def equipment_readings(equipment, ts: datetime, room_df: pd.DataFrame,
                       rng) -> pd.DataFrame:
    """power_kw for the equipment types that matter for detection/demo."""
    hour = ts.hour
    heat = max(0.0, float(np.sin(np.pi * (hour - 9) / 12))) if 9 <= hour <= 21 else 0.0
    room_power = (room_df[room_df["metric"] == "power_kw"]
                  .set_index("entity_id")["value"].to_dict())

    rows = []
    for _, eq in equipment.iterrows():
        eq_type = eq["eq_type"]
        if eq_type not in ("ac", "computers", "server_rack", "lathe", "pump",
                           "transformer", "lift"):
            continue
        rated = float(eq["rated_kw"])

        if eq_type == "transformer":
            value = sum(room_power.values()) * 0.95
        elif eq_type == "ac":
            value = rated * (0.1 + 0.9 * heat) * float(rng.normal(1.0, 0.08))
        elif eq_type in ("lift", "pump"):
            running = 9 <= hour < 18
            value = rated * (float(rng.uniform(0.2, 0.7)) if running else 0.02)
        else:
            value = rated * float(rng.uniform(0.4, 0.8)) * float(rng.normal(1.0, 0.06))

        rows.append({"ts": ts, "entity_id": eq["id"], "metric": "power_kw",
                     "value": max(value, 0)})

    return pd.DataFrame(rows)


def building_readings(buildings, room_df: pd.DataFrame, ts: datetime) -> pd.DataFrame:
    """Building totals = sum of their rooms, so panels always agree."""
    power = (room_df[room_df["metric"] == "power_kw"]
             .assign(bid=lambda d: d["entity_id"].str.split("-").str[0])
             .groupby("bid")["value"].sum())
    occ = (room_df[room_df["metric"] == "occupancy"]
           .assign(bid=lambda d: d["entity_id"].str.split("-").str[0])
           .groupby("bid")["value"].sum())
    water = (room_df[room_df["metric"] == "water_lpm"]
             .assign(bid=lambda d: d["entity_id"].str.split("-").str[0])
             .groupby("bid")["value"].sum())

    rows = []
    for bid in buildings["id"]:
        rows.append({"ts": ts, "entity_id": bid, "metric": "power_kw",
                     "value": float(power.get(bid, 0.0))})
        rows.append({"ts": ts, "entity_id": bid, "metric": "occupancy",
                     "value": float(occ.get(bid, 0.0))})
        rows.append({"ts": ts, "entity_id": bid, "metric": "water_lpm",
                     "value": float(water.get(bid, 0.0))})
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ faults


def apply_faults(df: pd.DataFrame, faults: list[dict], connections: dict,
                 rng) -> pd.DataFrame:
    """Bend readings so injected faults are visible immediately.

    spike      -> the entity and its ancestors draw 2-3x normal power
    ghost_load -> power stays at a fixed high value with 0 occupancy
    night_leak -> steady water flow regardless of occupancy
    """
    if not faults:
        return df

    parents = connections.get("parent", {})
    df = df.copy()

    for fault in faults:
        eid, kind = fault["entity_id"], fault["kind"]

        if kind == "spike":
            targets = [eid] + _ancestors_of(eid, parents)
            for target in targets:
                mask = (df["entity_id"] == target) & (df["metric"] == "power_kw")
                if mask.any():
                    df.loc[mask, "value"] = (
                        df.loc[mask, "value"] * float(fault.get("factor", 2.5))
                    )

        elif kind == "ghost_load":
            ghost_kw = 4.2 * float(rng.uniform(0.9, 1.1))
            for target in [eid] + _ancestors_of(eid, parents):
                mask = (df["entity_id"] == target) & (df["metric"] == "power_kw")
                if mask.any():
                    df.loc[mask, "value"] = df.loc[mask, "value"] + ghost_kw
                occ = (df["entity_id"] == target) & (df["metric"] == "occupancy")
                if occ.any():
                    df.loc[occ, "value"] = 0

        elif kind == "night_leak":
            leak_lpm = 5.4 * float(rng.uniform(0.9, 1.1))
            for target in [eid] + _ancestors_of(eid, parents):
                mask = (df["entity_id"] == target) & (df["metric"] == "water_lpm")
                if mask.any():
                    df.loc[mask, "value"] = df.loc[mask, "value"] + leak_lpm

    return df


def _ancestors_of(entity_id: str, parents: dict) -> list[str]:
    out, node, seen = [], entity_id, set()
    while node in parents and parents[node] not in seen:
        node = parents[node]
        seen.add(node)
        out.append(node)
    return out


def load_connections(data_dir: Path) -> dict:
    """Build child -> parent (electricity) plus parent -> children lookups.

    contract/db.md wires the tree as UT-SUB -> building -> floor -> equipment,
    so a room (B1-F1-R01) has no direct edge. Rooms therefore inherit their
    floor's parent; we resolve that chain here so fault propagation works for
    rooms as well as equipment and buildings.
    """
    path = data_dir / "connections.csv"
    if not path.exists():
        return {"parent": {}, "children": {}}

    conn = pd.read_csv(path)
    conn = conn[conn["utility"] == "electricity"]
    parent = dict(zip(conn["to_id"], conn["from_id"]))

    rooms_path = data_dir / "rooms.csv"
    if rooms_path.exists():
        rooms = pd.read_csv(rooms_path)
        for _, room in rooms.iterrows():
            rid, fid = room["id"], room["floor_id"]
            if rid not in parent and fid in parent:
                parent[rid] = fid

    children: dict[str, list[str]] = {}
    for child, par in parent.items():
        children.setdefault(par, []).append(child)

    return {"parent": parent, "children": children}


# ------------------------------------------------------------------ api


def post_readings(api: str, df: pd.DataFrame, session: requests.Session) -> int:
    payload = df[["ts", "entity_id", "metric", "value"]].copy()
    payload["ts"] = payload["ts"].apply(lambda t: t.isoformat())
    rows = payload.to_dict("records")

    inserted = 0
    for start in range(0, len(rows), BATCH_CHUNK):
        chunk = rows[start:start + BATCH_CHUNK]
        resp = session.post(f"{api}/api/readings",
                            json={"readings": chunk}, timeout=15)
        if resp.status_code >= 400:
            print(f"  ! /api/readings {resp.status_code}: {resp.text[:200]}")
            break
        inserted += int(resp.json().get("inserted", len(chunk)))
    return inserted


def fetch_faults(api: str, session: requests.Session) -> list[dict]:
    try:
        resp = session.get(f"{api}/api/insights/sim/faults", timeout=5)
        if resp.status_code < 400:
            return resp.json()
    except requests.RequestException:
        pass
    return []


def post_run(api: str, session: requests.Session) -> dict | None:
    try:
        resp = session.post(f"{api}/api/insights/run", timeout=30)
        if resp.status_code < 400:
            return resp.json()
    except requests.RequestException:
        pass
    return None


# ------------------------------------------------------------------ main


def main() -> int:
    ap = argparse.ArgumentParser(description="CampusTwin live simulator")
    ap.add_argument("--api", default=C.API_URL)
    ap.add_argument("--data", default=str(C.DATA_DIR))
    ap.add_argument("--tick", type=float, default=C.SIM_TICK_SECONDS,
                    help="seconds between ticks")
    ap.add_argument("--speed", type=int, default=C.SIM_HOURS_PER_TICK,
                    help="simulated hours advanced per tick")
    ap.add_argument("--run-every", type=int, default=C.SIM_RUN_EVERY_TICKS,
                    help="call /api/insights/run every N ticks (0 = never)")
    ap.add_argument("--dry-run", action="store_true", help="print instead of POST")
    ap.add_argument("--once", action="store_true", help="run one tick and exit")
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed if args.seed is not None else C.SEED)
    data_dir = Path(args.data)
    buildings, rooms, equipment = load_campus(data_dir)
    connections = load_connections(data_dir)

    session = requests.Session()
    clock = datetime.now(tz=timezone.utc).replace(minute=0, second=0, microsecond=0)
    tick = 0

    print(f"simulator -> {args.api}")
    print(f"  {len(buildings)} buildings · {len(rooms)} rooms · {len(equipment)} equipment")
    print(f"  tick {args.tick}s · +{args.speed}h per tick · run-every {args.run_every}")
    if args.dry_run:
        print("  DRY RUN: nothing will be sent")
    print()

    try:
        while True:
            tick += 1
            faults = fetch_faults(args.api, session) if not args.dry_run else []

            all_rows = []
            for step in range(args.speed):
                ts = clock + timedelta(hours=step)
                rdf = room_readings(rooms, buildings, ts, rng)
                edf = equipment_readings(equipment, ts, rdf, rng)
                bdf = building_readings(buildings, rdf, ts)

                frame = pd.concat([rdf, edf, bdf], ignore_index=True)
                frame = apply_faults(frame, faults, connections, rng)
                frame["source"] = "sim"
                all_rows.append(frame)

            out = pd.concat(all_rows, ignore_index=True)
            clock = clock + timedelta(hours=args.speed)

            if args.dry_run:
                inserted = len(out)
            else:
                inserted = post_readings(args.api, out, session)

            fault_desc = ", ".join(f"{f['entity_id']} {f['kind']}" for f in faults) or "none"
            print(f"tick {tick:>4} · {inserted:>5} readings · faults: {fault_desc}")

            if args.run_every and tick % args.run_every == 0 and not args.dry_run:
                result = post_run(args.api, session)
                if result:
                    print(f"           insights/run -> {result}")

            if args.once:
                return 0
            time.sleep(args.tick)

    except KeyboardInterrupt:
        print("\nstopped")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
