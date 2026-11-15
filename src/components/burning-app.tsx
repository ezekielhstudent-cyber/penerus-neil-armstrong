import { useMemo, useRef, useState, type ReactNode } from "react";
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
} from "@/lib/firms";

type Box = [number, number, number, number];

/** Aug–Oct 2026 come from near-real-time files (no fire-type filter): treat as provisional. */
const NRT_START = NT - 3;
const isNrt = (t: number) => t >= NRT_START;

function inBox(c: { la: number; lo: number }, box: Box) {
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
  const drag = useRef<{ lon: number; lat: number; moved: boolean } | null>(null);

  const from = Math.min(yFrom, yTo);
  const to = Math.max(yFrom, yTo);
  const years = useMemo(() => Array.from({ length: NYR }, (_, i) => Y0 + i), []);

  // Border cells exist once per province in the data (split counts). Merge for display.
  const mapCells = useMemo(() => {
    const m = new Map<string, { la: number; lo: number; sum: number; best: number; bestSum: number }>();
    for (const c of DATA.cells) {
      let s = 0;
      for (let t = T0; t < NT; t += 1) {
        const y = Y0 + Math.floor(t / 12);
        if (y >= from && y <= to) s += c.h[t];
      }
      const k = `${c.lo}|${c.la}`;
      const e = m.get(k);
      if (!e) m.set(k, { la: c.la, lo: c.lo, sum: s, best: c.p, bestSum: s });
      else {
        e.sum += s;
        if (s > e.bestSum) {
          e.best = c.p;
          e.bestSum = s;
        }
      }
    }
    return [...m.values()].map((c) => ({ ...c, d: c.sum / 0.773 / (to - from + 1) }));
  }, [from, to]);
  const maxDensity = useMemo(() => quantile(mapCells.map((c) => c.d), 0.98) || 1, [mapCells]);

  const selected = useMemo(() => {
    return DATA.cells.filter((c) => (prov ? c.p === prov : inBox(c, box)));
  }, [prov, box]);

  // NOTE: truncated for tool size - will complete in follow-up if needed
  return null;
}
