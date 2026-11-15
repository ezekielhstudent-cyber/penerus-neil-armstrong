import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Copy, Download, Flame } from "lucide-react";
import {
  BOX,
  CENTROIDS,
  DATA,
  DIV_STOPS,
  LM,
  LY,
  MONTHS,
  NT,
  NYR,
  PROV_IDS,
  T0,
  VIR_STOPS,
  VS,
  Y0,
  anomalyColor,
  fmtFull,
  fmtN,
  fmtSigned,
  gradient,
  heatColor,
  ink,
  provinceBox,
  quantile,
  rgb,
  shortProv,
  type Cell,
} from "@/lib/firms";

type Box = [number, number, number, number];

function inBox(c: Cell, box: Box) {
  return c.la >= box[0] && c.la <= box[1] && c.lo >= box[2] && c.lo <= box[3];
}

function coversIsland(box: Box) {
  return box[0] <= -4.4 && box[1] >= 4.4 && box[2] <= 108.6 && box[3] >= 118.4;
}

export function BurningApp() {
  const [prov, setProv] = useState<number | null>(null);
  const [box, setBox] = useState<Box>(BOX);
  const [yFrom, setYFrom] = useState(Y0);
  const [yTo, setYTo] = useState(LY);
  const [month, setMonth] = useState(LM);
  const [year, setYear] = useState(LY);
  const [copied, setCopied] = useState(false);

  const from = Math.min(yFrom, yTo);
  const to = Math.max(yFrom, yTo);
  const years = useMemo(() => Array.from({ length: NYR }, (_, i) => Y0 + i), []);

  const cellDensity = useMemo(() => {
    const yrs = Math.max(1, to - from + 1);
    return DATA.cells.map((c) => {
      let sum = 0;
      for (let t = T0; t < NT; t += 1) {
        const y = Y0 + Math.floor(t / 12);
        if (y >= from && y <= to) sum += c.h[t];
      }
      return sum / 0.773 / yrs;
    });
  }, [from, to]);

  const selected = useMemo(() => {
    return DATA.cells.filter((c) => (prov ? c.p === prov : inBox(c, box)));
  }, [prov, box]);

  const series = useMemo(() => {
    const harm = Array<number>(NT).fill(0);
    const raw = Array<number>(NT).fill(0);
    for (const c of selected) {
      for (let t = T0; t < NT; t += 1) {
        harm[t] += c.h[t];
        raw[t] += c.r[t];
      }
    }
    return { harm, raw };
  }, [selected]);

  const medians = useMemo(() => {
    return MONTHS.map((_, m) => {
      const vals: number[] = [];
      for (let y = 0; y < NYR - 1; y += 1) {
        const v = series.harm[y * 12 + m];
        if (y * 12 + m >= T0) vals.push(v);
      }
      return quantile(vals, 0.5);
    });
  }, [series]);

  const placeName = prov
    ? DATA.meta.prov[String(prov)]
    : coversIsland(box)
      ? "All Kalimantan"
      : "Custom area";

  const stats = useMemo(() => {
    let total = 0;
    let peak = 0;
    let peakT = -1;
    for (let t = T0; t < NT; t += 1) {
      const y = Y0 + Math.floor(t / 12);
      if (y < from || y > to) continue;
      total += series.harm[t];
      if (series.harm[t] > peak) {
        peak = series.harm[t];
        peakT = t;
      }
    }
    const yearTotals: number[] = [];
    for (let y = 1; y < NYR - 1; y += 1) {
      let sum = 0;
      for (let m = 0; m < 12; m += 1) sum += series.harm[y * 12 + m];
      yearTotals.push(sum);
    }
    const worstIndex = yearTotals.indexOf(Math.max(...yearTotals, 0));
    const worstYear = Y0 + worstIndex + 1;
    let typical = 0;
    medians.forEach((v, i) => {
      if (v > medians[typical]) typical = i;
    });
    return { total, peak, peakT, worstYear, typical };
  }, [series, from, to, medians]);

  const monthStatus = useMemo(() => {
    const t = (year - Y0) * 12 + month;
    if (t < T0 || t >= NT) return null;
    const hist: number[] = [];
    for (let y = 0; y < NYR; y += 1) {
      const i = y * 12 + month;
      if (Y0 + y === year || i < T0 || i >= NT) continue;
      hist.push(series.harm[i]);
    }
    const value = series.harm[t];
    const md = quantile(hist, 0.5);
    const q1 = quantile(hist, 0.25);
    const q3 = quantile(hist, 0.75);
    const lo = hist.length ? Math.min(...hist) : 0;
    const hi = hist.length ? Math.max(...hist) : 0;
    const rank = hist.length ? (100 * hist.filter((x) => x < value).length) / hist.length : 0;
    const flag =
      value > q3 ? "Unusually active" : value < q1 ? "Quieter than usual" : "Within the typical range";
    return { value, md, q1, q3, lo, hi, rank, flag, n: hist.length };
  }, [series, year, month]);

  const maxInRange = useMemo(() => {
    let mx = 1;
    for (let t = T0; t < NT; t += 1) {
      const y = Y0 + Math.floor(t / 12);
      if (y >= from && y <= to) mx = Math.max(mx, series.harm[t]);
    }
    return mx;
  }, [series, from, to]);

  const chart = useMemo(() => {
    const rows = [];
    let ymax = 1;
    for (let i = T0; i < NT; i += 1) ymax = Math.max(ymax, series.raw[i], series.harm[i]);
    for (let i = T0; i < NT; i += 1) {
      rows.push({ i, raw: series.raw[i], harm: series.harm[i] });
    }
    return { rows, ymax };
  }, [series]);

  const csv = useMemo(() => {
    let text = "year,month,source,raw_merged_count,harmonized_count,median_same_month,anomaly_pct\n";
    for (let i = T0; i < NT; i += 1) {
      const y = Y0 + Math.floor(i / 12);
      if (y < from || y > to) continue;
      const m = i % 12;
      const med = medians[m];
      const anomaly = med >= 3 ? (100 * (series.harm[i] - med)) / med : "";
      text += `${y},${m + 1},${i < VS ? "MODIS_Aqua" : "VIIRS_calibrated"},${Math.round(series.raw[i])},${Math.round(series.harm[i])},${Number.isFinite(med) ? med.toFixed(1) : ""},${typeof anomaly === "number" ? anomaly.toFixed(1) : ""}\n`;
    }
    return text;
  }, [series, medians, from, to]);



  function pickProvince(id: number | null) {
    setProv(id);
    setBox(id ? provinceBox(id) : BOX);
  }

  async function copyCsv() {
    try {
      await navigator.clipboard.writeText(csv);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  function downloadCsv() {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `karhutla-${placeName.replace(/\s+/g, "-").toLowerCase()}-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const ticks = [2005, 2010, 2015, 2020, 2025]
    .map((y) => (y - Y0) * 12)
    .filter((t) => t >= T0 && t < NT);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-3 border-b border-line pb-5">
        <div className="flex items-center gap-2 text-ember">
          <Flame className="size-4" aria-hidden="true" />
          <p className="text-xs font-semibold tracking-[0.16em] uppercase">NASA FIRMS · Kalimantan</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-4xl font-medium text-fg sm:text-5xl">Karhutla brief</h1>
            <p className="mt-2 max-w-2xl text-muted">
              Harmonized MODIS Aqua and VIIRS S-NPP hotspots, August 2002 through October 2026.
              VIIRS is scaled onto the Aqua baseline so the 2012 camera change does not look like a fourfold jump in fire.
            </p>
          </div>
          <p className="text-sm text-muted">
            Last complete month
            <span className="mt-0.5 block font-display text-xl text-fg">October 2026</span>
          </p>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="chip" data-on={prov === null && coversIsland(box)} onClick={() => pickProvince(null)}>
            All Kalimantan
          </button>
          {PROV_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className="chip"
              data-on={prov === id}
              onClick={() => pickProvince(id)}
            >
              {shortProv(DATA.meta.prov[String(id)])}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="field">
            <span>From</span>
            <select value={yFrom} onChange={(e) => setYFrom(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>To</span>
            <select value={yTo} onChange={(e) => setYTo(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Lat min / max</span>
            <input
              value={`${box[0].toFixed(2)}  →  ${box[1].toFixed(2)}`}
              readOnly
              aria-label="Latitude range"
            />
          </label>
          <label className="field">
            <span>Lon min / max</span>
            <input
              value={`${box[2].toFixed(2)}  →  ${box[3].toFixed(2)}`}
              readOnly
              aria-label="Longitude range"
            />
          </label>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <article className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-2xl text-fg">Where it burned</h2>
          <p className="mb-3 text-sm text-muted">
            Click a province, or drag a box. Color is hotspots per 1,000 km² per year, {from}–{to}.
          </p>
          <PlotlyCartoMap
            cellDensity={cellDensity}
            prov={prov}
            box={box}
            onPickProvince={pickProvince}
            onSelectBox={(nextBox) => {
              setProv(null);
              setBox(nextBox);
            }}
          />
          <div className="mt-3">
            <div
              className="legend-bar"
              style={{
                background:
                  "linear-gradient(to right, #fde725, #b5de2b, #6ece58, #35b779, #1f9e89, #26828e, #31688e, #3e4989, #482878, #440154)",
              }}
            />
            <div className="mt-1 flex justify-between text-xs text-muted">
              <span>0 (Quieter)</span>
              <span className="num">60+ / 1,000 km² / year (Viridis_r)</span>
            </div>
          </div>
        </article>

        <article className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
          <div>
            <h2 className="text-2xl text-fg">{placeName}</h2>
            <p className="text-sm text-muted">Is this month normal for the area you picked?</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="field">
              <span>Month</span>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTHS.map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Year</span>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!selected.length ? (
            <p className="text-sm text-muted">No fire cells in this box. Drag a larger area.</p>
          ) : !monthStatus ? (
            <p className="text-sm text-muted">Aqua’s first full month is August 2002, so earlier months are blank.</p>
          ) : (
            <MonthReadout status={monthStatus} month={month} year={year} />
          )}

          <dl className="grid grid-cols-2 gap-2">
            <Stat value={fmtFull(stats.total)} label={`Hotspots, ${from}–${to}`} />
            <Stat value={String(selected.length)} label="0.25° blocks" />
            <Stat
              value={stats.peakT < 0 ? "–" : `${MONTHS[stats.peakT % 12]} ${Y0 + Math.floor(stats.peakT / 12)}`}
              label={`Peak month · ${fmtN(stats.peak)}`}
            />
            <Stat value={`${MONTHS[stats.typical]} · ${stats.worstYear}`} label="Typical peak · worst year" />
          </dl>
        </article>
      </section>

      {selected.length > 0 && (
        <>
          <HeatCard
            title="Burning calendar"
            note="Harmonized hotspots each month. Color is on a log scale. January–July 2002 are blank."
            legend={gradient(VIR_STOPS)}
            legendLeft="0"
            legendRight={`${fmtN(maxInRange)} max in range`}
          >
            <HeatTable
              from={from}
              to={to}
              cell={(t) => series.harm[t]}
              color={(v) => heatColor(Math.log1p(v) / Math.log1p(maxInRange))}
              label={(v) => fmtN(v)}
              titleFor={(y, m, v) => `${MONTHS[m]} ${y}: ${fmtFull(v)} hotspots`}
            />
          </HeatCard>

          <HeatCard
            title="Against the usual month"
            note="Percent above or below the 2002–2025 median for that month. Months with a median under 3 hotspots are left blank."
            legend={gradient(DIV_STOPS)}
            legendLeft="−100%"
            legendRight="+300%"
          >
            <HeatTable
              from={from}
              to={to}
              cell={(t, m) => (medians[m] >= 3 ? (100 * (series.harm[t] - medians[m])) / medians[m] : null)}
              color={(v) => anomalyColor(v)}
              label={(v) => fmtSigned(v)}
              titleFor={(y, m, v) => `${MONTHS[m]} ${y}: ${fmtSigned(v)}% vs median`}
            />
          </HeatCard>

          <section className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
            <article className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="text-2xl text-fg">Raw series vs harmonized</h2>
              <p className="mb-3 text-sm text-muted">
                Dashed is Aqua until 2012, then raw VIIRS. Solid is VIIRS converted to Aqua-equivalent counts.
                The shaded band is the VIIRS era.
              </p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#3d362e" vertical={false} />
                    <ReferenceArea x1={VS} x2={NT - 1} fill="#2a261f" />
                    <XAxis
                      dataKey="i"
                      type="number"
                      domain={[T0, NT - 1]}
                      ticks={ticks}
                      tickFormatter={(i) => String(Y0 + Math.floor(Number(i) / 12))}
                      stroke="#b3a898"
                      tick={{ fill: "#b3a898", fontSize: 12 }}
                    />
                    <YAxis
                      tickFormatter={(v) => fmtN(Number(v))}
                      stroke="#b3a898"
                      tick={{ fill: "#b3a898", fontSize: 12 }}
                      width={42}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#1e1b17",
                        border: "1px solid #3d362e",
                        borderRadius: 10,
                        color: "#f4efe6",
                      }}
                      labelFormatter={(i) => {
                        const t = Number(i);
                        return `${MONTHS[t % 12]} ${Y0 + Math.floor(t / 12)}`;
                      }}
                      formatter={(value, name) => [
                        fmtFull(Number(value)),
                        name === "harm" ? "Harmonized" : "Raw merged",
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="raw"
                      name="raw"
                      stroke="#e07a3d"
                      strokeDasharray="4 3"
                      dot={false}
                      strokeWidth={1.4}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="harm"
                      name="harm"
                      stroke="#8faf86"
                      dot={false}
                      strokeWidth={1.8}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="text-2xl text-fg">Held-out check</h2>
              <p className="mb-3 text-sm text-muted">
                Each year in 2012–2020 is predicted from the other years. Bias is predicted minus observed.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs tracking-wide text-muted uppercase">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Year</th>
                      <th className="py-2 pr-3 font-medium">Aqua</th>
                      <th className="py-2 pr-3 font-medium">Raw</th>
                      <th className="py-2 font-medium">Harmonized</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DATA.validation.rows.map((row) => (
                      <tr key={row.y} className="border-t border-line">
                        <td className="py-2 pr-3">{row.y}</td>
                        <td className="num py-2 pr-3">{row.obs.toLocaleString("en-US")}</td>
                        <td className="num py-2 pr-3 text-ember">{fmtSigned(row.raw)}%</td>
                        <td className="num py-2 text-moss">{fmtSigned(row.h)}%</td>
                      </tr>
                    ))}
                    <tr className="border-t border-line font-semibold">
                      <td className="py-2 pr-3">Mean |bias|</td>
                      <td />
                      <td className="num py-2 pr-3">{Math.round(DATA.validation.mean.raw)}%</td>
                      <td className="num py-2 text-moss">{DATA.validation.mean.h.toFixed(1)}%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-sm text-muted">
                Correlation stays near {DATA.validation.mean.r.toFixed(2)}. Quiet years such as 2020 can still run high.
              </p>
            </article>
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl text-fg">Monthly table</h2>
              <p className="text-sm text-muted">
                Harmonized counts for {placeName}, {from}–{to}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copyCsv}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-ember px-4 text-sm font-semibold text-ember-ink"
              >
                <Copy className="size-4" aria-hidden="true" />
                {copied ? "Copied" : "Copy CSV"}
              </button>
              <button
                type="button"
                onClick={downloadCsv}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-fg"
              >
                <Download className="size-4" aria-hidden="true" />
                Download
              </button>
            </div>
          </section>
        </>
      )}

      <footer className="border-t border-line pt-4 text-sm text-muted">
        Vegetation fires only (type 0), confidence at least 50 on Aqua and nominal or high on VIIRS S-NPP.
        One hotspot per 1 km cell per local day. Province borders are a rough division, not an official boundary.
        August–October 2026 come from near-real-time files, which have no fire-type field. Terra is not used.
      </footer>
    </main>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num font-display text-xl text-fg">{value}</dd>
    </div>
  );
}

function MonthReadout({
  status,
  month,
  year,
}: {
  status: {
    value: number;
    md: number;
    q1: number;
    q3: number;
    lo: number;
    hi: number;
    rank: number;
    flag: string;
    n: number;
  };
  month: number;
  year: number;
}) {
  const scale = Math.max(status.value, status.hi, 1) * 1.05;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / scale) * 100))}%`;
  const tone =
    status.flag === "Unusually active" ? "text-ember" : status.flag === "Quieter than usual" ? "text-moss" : "text-fg";
  const delta = status.md > 0 ? fmtSigned((100 * (status.value - status.md)) / status.md) : "n/a";

  return (
    <div className="flex flex-col gap-3">
      <p>
        <span className="font-display text-3xl text-fg">
          {MONTHS[month]} {year}
        </span>
        <span className={`mt-1 block text-lg font-semibold ${tone}`}>{status.flag}</span>
      </p>
      <p className="text-sm text-muted">
        <span className="num text-fg">{fmtFull(status.value)}</span> hotspots · median{" "}
        <span className="num">{fmtN(status.md)}</span> · {delta}% · higher than {Math.round(status.rank)}% of other{" "}
        {MONTHS[month]}s ({status.n} years).
      </p>
      <div className="relative h-12" aria-hidden="true">
        <div
          className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-line"
          style={{ left: pct(status.lo), width: `calc(${pct(status.hi)} - ${pct(status.lo)})` }}
        />
        <div
          className="absolute top-3 h-6 rounded-md bg-line"
          style={{ left: pct(status.q1), width: `calc(${pct(status.q3)} - ${pct(status.q1)})` }}
        />
        <div className="absolute top-2 h-8 w-0.5 bg-fg" style={{ left: pct(status.md) }} />
        <div
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ember"
          style={{ left: pct(status.value) }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted">
        <span>min {fmtN(status.lo)}</span>
        <span>box is 25–75%, bar is median</span>
        <span>max {fmtN(status.hi)}</span>
      </div>
    </div>
  );
}

function HeatCard({
  title,
  note,
  legend,
  legendLeft,
  legendRight,
  children,
}: {
  title: string;
  note: string;
  legend: string;
  legendLeft: string;
  legendRight: string;
  children: ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-2xl text-fg">{title}</h2>
      <p className="mb-3 text-sm text-muted">{note}</p>
      <div className="overflow-x-auto">{children}</div>
      <div className="mt-3">
        <div className="legend-bar" style={{ background: legend }} />
        <div className="mt-1 flex justify-between text-xs text-muted">
          <span>{legendLeft}</span>
          <span>{legendRight}</span>
        </div>
      </div>
    </article>
  );
}

function HeatTable({
  from,
  to,
  cell,
  color,
  label,
  titleFor,
}: {
  from: number;
  to: number;
  cell: (t: number, m: number) => number | null;
  color: (v: number) => [number, number, number];
  label: (v: number) => string;
  titleFor: (y: number, m: number, v: number) => string;
}) {
  const rows = [];
  for (let y = from; y <= to; y += 1) rows.push(y);
  return (
    <table className="heat">
      <thead>
        <tr>
          <th />
          {MONTHS.map((m) => (
            <th key={m}>{m}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((y) => (
          <tr key={y}>
            <th>{y}</th>
            {MONTHS.map((_, m) => {
              const t = (y - Y0) * 12 + m;
              const v = t >= T0 && t < NT ? cell(t, m) : null;
              if (v == null || !Number.isFinite(v)) {
                return (
                  <td key={m} className="nd">
                    ·
                  </td>
                );
              }
              const c = color(v);
              return (
                <td key={m} title={titleFor(y, m, v)} style={{ background: rgb(c), color: ink(c) }}>
                  {label(v)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}


declare global {
  interface Window {
    Plotly?: {
      react: (el: HTMLElement, data: unknown[], layout: Record<string, unknown>, config?: Record<string, unknown>) => Promise<HTMLElement>;
      purge: (el: HTMLElement) => void;
    };
  }
}

let plotlyLoader: Promise<NonNullable<Window["Plotly"]>> | null = null;

function loadPlotly(): Promise<NonNullable<Window["Plotly"]>> {
  if (typeof window !== "undefined" && window.Plotly) {
    return Promise.resolve(window.Plotly);
  }
  if (!plotlyLoader) {
    plotlyLoader = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-plotly-cdn="1"]');
      if (existing) {
        existing.addEventListener("load", () => (window.Plotly ? resolve(window.Plotly) : reject(new Error("Plotly missing"))));
        existing.addEventListener("error", () => reject(new Error("Failed to load Plotly")));
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.plot.ly/plotly-2.35.2.min.js";
      script.async = true;
      script.dataset.plotlyCdn = "1";
      script.onload = () => {
        if (window.Plotly) resolve(window.Plotly);
        else reject(new Error("Plotly unavailable after load"));
      };
      script.onerror = () => reject(new Error("Failed to load Plotly script"));
      document.head.appendChild(script);
    });
  }
  return plotlyLoader;
}

function PlotlyCartoMap({
  cellDensity,
  prov,
  box,
  onPickProvince,
  onSelectBox,
}: {
  cellDensity: number[];
  prov: number | null;
  box: Box;
  onPickProvince: (id: number | null) => void;
  onSelectBox: (box: Box) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loadError, setLoadError] = useState(false);
  const handlersRef = useRef({ onPickProvince, onSelectBox });
  handlersRef.current = { onPickProvince, onSelectBox };

  useEffect(() => {
    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;

    const lats: number[] = [];
    const lons: number[] = [];
    const vals: number[] = [];
    const opacities: number[] = [];
    const texts: string[] = [];

    for (let i = 0; i < DATA.cells.length; i += 1) {
      const c = DATA.cells[i];
      const d = cellDensity[i] ?? 0;
      const on = prov ? c.p === prov : inBox(c, box);
      lats.push(c.la);
      lons.push(c.lo);
      vals.push(d);
      opacities.push(on ? 0.92 : 0.22);
      const pName = shortProv(DATA.meta.prov[String(c.p)]);
      texts.push(
        `<b>${pName} Kalimantan</b><br>Lat ${c.la.toFixed(2)}°, Lon ${c.lo.toFixed(2)}°<br><b>${d.toFixed(1)}</b> hotspots / 1,000 km² / yr`
      );
    }

    const traces: unknown[] = [
      {
        type: "scattermapbox",
        lat: lats,
        lon: lons,
        mode: "markers",
        text: texts,
        hoverinfo: "text",
        marker: {
          size: 11,
          symbol: "circle",
          color: vals,
          colorscale: "Viridis_r",
          cmin: 0,
          cmax: 60,
          opacity: opacities,
          showscale: false,
        },
      },
      {
        type: "scattermapbox",
        lat: PROV_IDS.map((id) => CENTROIDS[id][1]),
        lon: PROV_IDS.map((id) => CENTROIDS[id][0]),
        mode: "text",
        text: PROV_IDS.map((id) => shortProv(DATA.meta.prov[String(id)])),
        hoverinfo: "skip",
        textfont: {
          family: "Inter, system-ui, sans-serif",
          size: 12,
          color: "#1e1b17",
        },
      },
    ];

    const layout: Record<string, unknown> = {
      autosize: true,
      height: 410,
      margin: { l: 0, r: 0, t: 0, b: 0 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      dragmode: "pan",
      mapbox: {
        style: "carto-positron",
        center: { lat: -0.2, lon: 113.8 },
        zoom: 4.55,
      },
      showlegend: false,
    };

    const config: Record<string, unknown> = {
      responsive: true,
      displaylogo: false,
      scrollZoom: true,
      modeBarButtonsToRemove: ["toImage", "sendDataToCloud", "autoScale2d"],
    };

    loadPlotly()
      .then((Plotly) => {
        if (cancelled || !containerRef.current) return;
        return Plotly.react(containerRef.current, traces, layout, config).then((gd) => {
          if (cancelled) return;
          const node = gd as HTMLElement & {
            removeAllListeners?: (ev: string) => void;
            on?: (ev: string, fn: (data: any) => void) => void;
          };
          node.removeAllListeners?.("plotly_click");
          node.removeAllListeners?.("plotly_selected");

          node.on?.("plotly_click", (ev) => {
            const pt = ev?.points?.[0];
            if (!pt || pt.curveNumber !== 0) return;
            const cell = DATA.cells[pt.pointIndex];
            if (cell) handlersRef.current.onPickProvince(cell.p);
          });

          node.on?.("plotly_selected", (ev) => {
            const pts = ev?.points?.filter((p: any) => p.curveNumber === 0) ?? [];
            if (!pts.length) return;
            const selLats = pts.map((p: any) => Number(p.lat));
            const selLons = pts.map((p: any) => Number(p.lon));
            handlersRef.current.onSelectBox([
              Math.min(...selLats) - 0.125,
              Math.max(...selLats) + 0.125,
              Math.min(...selLons) - 0.125,
              Math.max(...selLons) + 0.125,
            ]);
          });
        });
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [cellDensity, prov, box]);

  useEffect(() => {
    const el = containerRef.current;
    return () => {
      if (el && window.Plotly) {
        window.Plotly.purge(el);
      }
    };
  }, []);

  if (loadError) {
    return (
      <div className="flex h-[410px] items-center justify-center rounded-xl border border-line bg-surface-2 p-4 text-sm text-muted">
        Unable to load interactive map tiles. Use the province buttons above to filter.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-[#f4f6f8]">
      <div ref={containerRef} className="h-[410px] w-full" aria-label="Kalimantan interactive hotspot map" />
    </div>
  );
}
