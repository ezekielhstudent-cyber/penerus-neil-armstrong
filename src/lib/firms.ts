import raw from "@/data/app_data.json";

export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export type Cell = {
  la: number;
  lo: number;
  p: number;
  h: number[];
  r: number[];
};

export type AppData = {
  meta: {
    y0: number;
    nt: number;
    t0: number;
    vs: number;
    ov_end: number;
    ratios: number[];
    utc_shift: number;
    last_month: string;
    prov: Record<string, string>;
  };
  validation: {
    rows: { y: number; raw: number; h: number; r: number; obs: number }[];
    mean: { raw: number; h: number; r: number };
  };
  cells: Cell[];
};

export const DATA = raw as AppData;

export const Y0 = DATA.meta.y0;
export const NT = DATA.meta.nt;
export const T0 = DATA.meta.t0;
export const VS = DATA.meta.vs;
export const LY = Y0 + Math.floor((NT - 1) / 12);
export const LM = (NT - 1) % 12;
export const NYR = LY - Y0 + 1;
export const BOX: [number, number, number, number] = [-4.5, 4.5, 108.5, 118.5];
export const PROV_IDS = [1, 2, 3, 4, 5] as const;

const VIR: [number, number, number][] = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 73, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [110, 206, 88],
  [181, 222, 43],
  [253, 231, 37],
];

const DIV: [number, number, number][] = [
  [33, 102, 172],
  [103, 169, 207],
  [244, 239, 230],
  [224, 150, 78],
  [176, 72, 28],
];

export function ramp(stops: [number, number, number][], t: number) {
  const x = Math.max(0, Math.min(1, t));
  const p = x * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(p));
  const f = p - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ] as [number, number, number];
}

export const heatColor = (t: number) => ramp(VIR, t);
export const anomalyColor = (v: number) =>
  ramp(DIV, v < 0 ? 0.5 + 0.5 * (Math.max(v, -100) / 100) : 0.5 + 0.5 * (Math.min(v, 300) / 300));

export function rgb(c: readonly [number, number, number]) {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function ink(c: readonly [number, number, number]) {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] > 150 ? "#1c1915" : "#f4efe6";
}

export function quantile(values: number[], q: number) {
  if (!values.length) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const p = (s.length - 1) * q;
  const i = Math.floor(p);
  return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (p - i);
}

export function fmtN(v: number) {
  if (!Number.isFinite(v)) return "–";
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}

export function fmtFull(v: number) {
  if (!Number.isFinite(v)) return "–";
  return Math.round(v).toLocaleString("en-US");
}

export function fmtSigned(v: number) {
  if (!Number.isFinite(v)) return "–";
  const n = Math.round(v);
  return n > 0 ? `+${n}` : String(n);
}

export function shortProv(name: string) {
  return name.replace(" Kalimantan", "");
}

export function provinceBox(id: number): [number, number, number, number] {
  const cells = DATA.cells.filter((c) => c.p === id);
  const las = cells.map((c) => c.la);
  const los = cells.map((c) => c.lo);
  return [
    Math.min(...las) - 0.125,
    Math.max(...las) + 0.125,
    Math.min(...los) - 0.125,
    Math.max(...los) + 0.125,
  ];
}

export const CENTROIDS: Record<number, [number, number]> = {};
for (const id of PROV_IDS) {
  const cells = DATA.cells.filter((c) => c.p === id);
  CENTROIDS[id] = [
    cells.reduce((s, c) => s + c.lo, 0) / cells.length,
    cells.reduce((s, c) => s + c.la, 0) / cells.length,
  ];
}

export function gradient(stops: [number, number, number][]) {
  return `linear-gradient(to right, ${stops.map((c) => rgb(c)).join(", ")})`;
}

export const VIR_STOPS = VIR;
export const DIV_STOPS = DIV;
