#!/usr/bin/env python3
"""
Harmonize MODIS Aqua (M-C61) and VIIRS S-NPP (SV-C2) hotspots for Kalimantan.

Produces the app_data.json that the React dashboard reads.

Usage
-----
  # 1. Unzip the two NASA FIRMS downloads into a raw directory:
  #      fire_archive_M-C61_*.csv   fire_nrt_M-C61_*.csv
  #      fire_archive_SV-C2_*.csv   fire_nrt_SV-C2_*.csv
  mkdir -p data/raw
  unzip attachments/DL_FIRE_M-C61_*.zip -d data/raw
  unzip attachments/DL_FIRE_SV-C2_*.zip -d data/raw

  # 2. Run the pipeline (needs pandas + numpy):
  python pipeline/harmonize_hotspots.py --raw data/raw --out data/processed

  # 3. Copy the result into the app:
  cp data/processed/app_data.json src/data/app_data.json

What it does
------------
- Keeps only vegetation fires (type == 0 when present; NRT files have no type field).
- Aqua: satellite == "Aqua" and confidence >= 50.
- VIIRS: confidence in {n, h}.
- Collapses detections to one hotspot per 1 km cell per local day
  (UTC + 7.5 h midpoint of WIB/WITA).
- Clips to an approximate Kalimantan polygon and assigns rough province IDs.
- Aggregates to 0.25° blocks × province × month.
- Fits a per-calendar-month Aqua/VIIRS ratio on the 2012-02 … 2020-12 overlap.
- Applies the ratio to VIIRS months so the whole series is on an Aqua-equivalent scale.
- Leave-one-year-out validation for 2012–2020 (reported in the JSON).
- Writes app_data.json (dashboard) and cell_days.csv.gz (optional 1 km download).

Known limits (also documented in the app README)
------------------------------------------------
- Aug–Oct 2026 come from near-real-time files → no fire-type filter → marked provisional.
- Harmonization is a model, not a measurement. Held-out mean |bias| ≈ 11 %.
- Province polygons are approximate rectangles / ray-cast outlines, not official boundaries.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Constants (must stay in sync with src/lib/firms.ts and the dashboard)
# ---------------------------------------------------------------------------
G = 0.01          # 1 km analysis grid
BLK = 0.25        # 0.25° display blocks
UTC_H = 7.5       # local-time shift (midpoint WIB/WITA)

Y0 = 2002
END = pd.Timestamp("2026-10-01")          # last complete month in the supplied data
VS = pd.Timestamp("2012-02-01")           # first full VIIRS month
OV_END = pd.Timestamp("2020-12-01")       # end of stable Aqua/VIIRS overlap used for ratios

PROV = {
    1: "West Kalimantan",
    2: "Central Kalimantan",
    3: "South Kalimantan",
    4: "East Kalimantan",
    5: "North Kalimantan",
}

# Approximate outline of Indonesian Kalimantan (lon, lat).
# Replace with an official boundary file for production use.
POLY = [
    (109.6, 1.9), (110.5, 1.5), (111.0, 1.1), (112.2, 1.4), (114.0, 1.3),
    (114.8, 2.2), (115.5, 3.5), (116.2, 4.4), (117.4, 4.4), (117.9, 4.2),
    (118.1, 3.8), (117.6, 2.0), (118.1, 1.0), (117.6, 0.0), (117.2, -1.0),
    (116.6, -1.9), (116.2, -3.2), (115.4, -3.9), (114.6, -4.1), (113.6, -3.5),
    (112.5, -3.5), (111.7, -3.3), (110.3, -3.1), (110.1, -2.0), (109.9, -1.0),
    (109.2, -0.2), (108.9, 0.8), (108.9, 1.8),
]


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------
def inside(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Point-in-polygon (ray casting) for the Kalimantan outline."""
    c = np.zeros(len(x), dtype=bool)
    n = len(POLY)
    for k in range(n):
        (x1, y1), (x2, y2) = POLY[k], POLY[(k + 1) % n]
        c ^= ((y1 > y) != (y2 > y)) & (x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1)
    return c


def province(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Rough province assignment (same rule the web map uses)."""
    return np.select(
        [
            (lat >= 2.0) & (lon >= 114.2),   # North
            (lon >= 114.6) & (lat >= -1.9),  # East
            lon >= 114.6,                    # South
            (lon < 111.2) | (lat >= 0.2),    # West
        ],
        [5, 4, 3, 1],
        default=2,  # Central
    )


# ---------------------------------------------------------------------------
# Ingest one sensor
# ---------------------------------------------------------------------------
def read(raw: str, product: str, sensor: str) -> pd.DataFrame:
    """
    Clean one sensor:
    - vegetation fires only (type == 0 when the column exists; NRT has no type)
    - confident detections
    - one hotspot per 1 km cell per local day
    """
    paths = sorted(glob.glob(f"{raw}/fire_*_{product}_*.csv"))
    if not paths:
        raise FileNotFoundError(f"No files matching fire_*_{product}_*.csv in {raw}")

    usecols = lambda c: c in {
        "latitude", "longitude", "acq_date", "acq_time",
        "satellite", "confidence", "type", "frp",
    }
    parts = [pd.read_csv(f, usecols=usecols) for f in paths]
    d = pd.concat(parts, ignore_index=True)

    # Geographic pre-filter (slightly larger than the final polygon)
    d = d[d["latitude"].between(-4.6, 4.6) & d["longitude"].between(108.5, 119.0)]

    # Vegetation filter (absent in NRT → keep those rows and mark them provisional later)
    if "type" in d.columns:
        d = d[d["type"].isna() | (d["type"] == 0)]

    if sensor == "aqua":
        d = d[(d["satellite"] == "Aqua") & (pd.to_numeric(d["confidence"], errors="coerce") >= 50)]
    else:
        d = d[d["confidence"].astype(str).isin(["n", "h"])]

    # Local day (UTC + 7.5 h)
    hhmm = d["acq_time"].astype(int)
    ts = (
        pd.to_datetime(d["acq_date"])
        + pd.to_timedelta(hhmm // 100 * 60 + hhmm % 100, unit="m")
        + pd.Timedelta(hours=UTC_H)
    )
    d = d.assign(
        date=ts.dt.floor("D"),
        gi=np.floor(d["latitude"] / G).astype(np.int32),
        gj=np.floor(d["longitude"] / G).astype(np.int32),
    )

    # One detection per 1 km cell per local day (keep max FRP)
    out = d.groupby(["date", "gi", "gj"], as_index=False).agg(frp=("frp", "max"))
    print(f"{sensor}: {len(d):,} detections → {len(out):,} 1 km cell-days")
    return out.assign(sensor=sensor)


def fit(A: np.ndarray, V: np.ndarray, T: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """MODIS-Aqua / VIIRS ratio per calendar month over the months selected by mask."""
    return np.array([
        A[:, mask & (T % 12 == m)].sum() / max(V[:, mask & (T % 12 == m)].sum(), 1.0)
        for m in range(12)
    ])


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", default="data/raw", help="Directory with unzipped FIRMS CSVs")
    ap.add_argument("--out", default="data/processed", help="Output directory")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)

    # 1. Ingest both sensors
    cd = pd.concat(
        [
            read(args.raw, "M-C61", "aqua"),
            read(args.raw, "SV-C2", "viirs"),
        ],
        ignore_index=True,
    )

    # 2. Clip unique 1 km cells to Kalimantan and assign province
    u = cd[["gi", "gj"]].drop_duplicates().reset_index(drop=True)
    lon = (u["gj"] + 0.5) * G
    lat = (u["gi"] + 0.5) * G
    mask = inside(lon.values, lat.values)
    u = u.loc[mask].copy()
    u["lat"] = lat[mask]
    u["lon"] = lon[mask]
    u["prov"] = province(u["lon"].values, u["lat"].values)
    u["bi"] = np.floor(u["lat"] / BLK).astype(int)
    u["bj"] = np.floor(u["lon"] / BLK).astype(int)

    cd = cd.merge(u, on=["gi", "gj"])
    print(f"inside Kalimantan: {len(cd):,} cell-days")

    # Optional 1 km download used by the old standalone frontend
    out_cd = cd[["date", "sensor", "lat", "lon", "prov", "frp"]].copy()
    out_cd["lat"] = out_cd["lat"].round(4)
    out_cd["lon"] = out_cd["lon"].round(4)
    out_cd["frp"] = out_cd["frp"].round(4)
    out_cd.to_csv(f"{args.out}/cell_days.csv.gz", index=False, compression="gzip")

    # 3. Monthly counts per 0.25° block × province × sensor
    ms = pd.date_range(f"{Y0}-01-01", END, freq="MS")
    NT = len(ms)
    cd["t"] = (cd["date"].dt.year - Y0) * 12 + cd["date"].dt.month - 1
    cd = cd[(cd["t"] >= 0) & (cd["t"] < NT)]

    keys = (
        cd[["bi", "bj", "prov"]]
        .drop_duplicates()
        .sort_values(["prov", "bi", "bj"])
        .reset_index(drop=True)
    )
    keys["k"] = keys.index
    cd = cd.merge(keys, on=["bi", "bj", "prov"])

    arr = {s: np.zeros((len(keys), NT), dtype=np.float64) for s in ("aqua", "viirs")}
    for s, g in cd.groupby("sensor"):
        c = g.groupby(["k", "t"]).size()
        arr[s][c.index.get_level_values(0), c.index.get_level_values(1)] = c.values

    A, V = arr["aqua"], arr["viirs"]
    T = np.arange(NT)
    tvs = (VS.year - Y0) * 12 + VS.month - 1
    tov = (OV_END.year - Y0) * 12 + OV_END.month - 1

    d0 = cd.loc[cd["sensor"] == "aqua", "date"].min()
    t0 = (d0.year - Y0) * 12 + d0.month - 1 + (0 if d0.day == 1 else 1)
    print(f"first Aqua day {d0.date()} → first full month {ms[t0].date()}")

    # 4. Fit monthly ratios on the overlap window and harmonize
    ov = (T >= tvs) & (T <= tov)
    R = fit(A, V, T, ov)
    H = np.where(T < tvs, A, V * R[T % 12])
    H[:, :t0] = 0
    RAW = np.where(T < tvs, A, V)
    RAW[:, :t0] = 0

    # 5. Leave-one-year-out validation (2012–2020)
    P = [keys.loc[keys["prov"] == p, "k"].values for p in PROV]
    sumP = lambda X: np.array([X[idx].sum(axis=0) for idx in P])  # province × month
    Ap, Vp = sumP(A), sumP(V)

    rows = []
    for y in range(2012, 2021):
        mask = ov & ((T // 12 + Y0) != y)
        r = fit(A, V, T, mask)
        ts = [t for t in range(tvs, tov + 1) if t // 12 + Y0 == y]
        obs = Ap[:, ts]
        vv = Vp[:, ts]
        pred = vv * r[np.array(ts) % 12]
        rows.append({
            "y": y,
            "raw": 100 * (vv.sum() - obs.sum()) / obs.sum(),
            "h": 100 * (pred.sum() - obs.sum()) / obs.sum(),
            "r": float(np.corrcoef(pred.ravel(), obs.ravel())[0, 1]),
            "obs": int(obs.sum()),
        })

    val = {
        "rows": rows,
        "mean": {
            "raw": float(np.mean([abs(x["raw"]) for x in rows])),
            "h": float(np.mean([abs(x["h"]) for x in rows])),
            "r": float(np.mean([x["r"] for x in rows])),
        },
    }
    print(pd.DataFrame(rows).round(2).to_string(index=False))
    print("ratios", R.round(3))

    # 6. Emit the JSON the React app expects
    cells = [
        {
            "la": float((r.bi + 0.5) * BLK),
            "lo": float((r.bj + 0.5) * BLK),
            "p": int(r.prov),
            "h": [int(round(v)) for v in H[r.k]],
            "r": [int(v) for v in RAW[r.k]],
        }
        for r in keys.itertuples()
    ]
    cells = [c for c in cells if sum(c["h"]) > 0]

    meta = {
        "y0": Y0,
        "nt": NT,
        "t0": int(t0),
        "vs": int(tvs),
        "ov_end": int(tov),
        "ratios": [float(x) for x in R],
        "utc_shift": UTC_H,
        "last_month": str(ms[-1].date()),
        "prov": {str(k): v for k, v in PROV.items()},
    }

    out_path = Path(args.out) / "app_data.json"
    with open(out_path, "w") as f:
        json.dump({"meta": meta, "validation": val, "cells": cells}, f, separators=(",", ":"))

    print(f"cells: {len(cells)}  json MB: {out_path.stat().st_size / 1e6:.2f}")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
