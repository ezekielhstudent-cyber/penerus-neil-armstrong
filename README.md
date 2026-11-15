# Karhutla brief — Kalimantan fire hotspots (NASA FIRMS)

Interactive monthly burning calendar for Kalimantan, Aug 2002 – Oct 2026.
Aqua MODIS (2002–2012) and VIIRS S-NPP (2012+) hotspots are put on one scale
by multiplying VIIRS counts by a per-calendar-month ratio fitted on the 2012–2020 overlap.

Run: `npm install && npm run dev` (port 8080). Data the app reads: `src/data/app_data.json`.

## Rebuild the data (reproducibility)

Raw FIRMS downloads live in `attachments/`. The pipeline that turns them into
`app_data.json` is:

```bash
# 1. Unzip the NASA archives
mkdir -p data/raw
unzip attachments/DL_FIRE_M-C61_*.zip -d data/raw
unzip attachments/DL_FIRE_SV-C2_*.zip -d data/raw

# 2. Run the pipeline (needs pandas + numpy)
python pipeline/harmonize_hotspots.py --raw data/raw --out data/processed

# 3. Install the result into the app
cp data/processed/app_data.json src/data/app_data.json
```

The script also writes `data/processed/cell_days.csv.gz` (1 km hotspot-days)
for optional downstream use.

## Read before quoting numbers

- **Aug–Oct 2026 are provisional.** They come from near-real-time files, which have no fire-type field,
  so the vegetation-only filter used for earlier months is not applied. Marked with dashed cells in the UI.
- **Harmonization is a model, not a measurement.** Ratios are fitted on 2012–2020 and assumed stable afterwards.
  Held-out mean |bias| is ~11 %, but 2020 misses by +41 %.
- **Province lines are rough rectangles**, not official boundaries. Cells on a border are split between provinces in the data.
