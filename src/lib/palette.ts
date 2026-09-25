export type Rgb = { r: number; g: number; b: number };
export type Hsl = { h: number; s: number; l: number };

export type Swatch = {
  hex: string;
  rgb: Rgb;
  hsl: Hsl;
};

export const HARMONIES = [
  {
    id: "analogous",
    label: "Analog",
    tip: "Neighbors on the color wheel, like blue, cyan, and teal. Calm and related.",
  },
  {
    id: "complementary",
    label: "Complement",
    tip: "Opposites on the wheel, like blue and orange. Strong contrast.",
  },
  {
    id: "triadic",
    label: "Triad",
    tip: "Three colors spaced evenly, like a triangle. Lively but still balanced.",
  },
  {
    id: "split",
    label: "Split",
    tip: "One color, plus the two beside its opposite. Contrast, but softer.",
  },
  {
    id: "mono",
    label: "Mono",
    tip: "One color only, from dark to light. Safe for backgrounds, text, and buttons.",
  },
  {
    id: "free",
    label: "Free",
    tip: "Unrelated colors with no matching rule. Use it when you want a surprise.",
  },
  {
    id: "gradient",
    label: "Gradient",
    tip: "Five smooth fades, each a ramp from dark to light. Click a ramp to load it.",
  },
] as const;

export type Harmony = (typeof HARMONIES)[number]["id"];

/** Workfolio ink, paper, and canvas — the text colors contrast is checked against. */
export const INK: Rgb = { r: 11, g: 18, b: 32 };
export const PAPER: Rgb = { r: 232, g: 238, b: 249 };
export const CANVAS: Rgb = { r: 7, g: 10, b: 18 };

export type Grade = "AAA" | "AA" | "AA lg" | "Fail";

export type ContrastRow = {
  id: string;
  label: string;
  ratio: number;
  grade: Grade;
  hint: string;
};

const SEED_HEX = ["#12162B", "#7C5CFF", "#22D3EE", "#F472B6", "#34D399"];

const ROLES: { l: number; s: number }[] = [
  { l: 14, s: 46 },
  { l: 32, s: 64 },
  { l: 52, s: 78 },
  { l: 68, s: 70 },
  { l: 86, s: 42 },
];

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function hueNorm(h: number) {
  const x = Math.round(h) % 360;
  return x < 0 ? x + 360 : x;
}

export function isHarmony(value: unknown): value is Harmony {
  return HARMONIES.some((item) => item.id === value);
}

export function rgbToHex(rgb: Rgb) {
  const part = (n: number) =>
    clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0").toUpperCase();
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

export function rgbToHsl(rgb: Rgb): Hsl {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l: Math.round(l * 100) };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
  }
  return {
    h: Math.round((h / 6) * 360) % 360,
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const H = hueNorm(h) / 360;
  const S = clamp(s, 0, 100) / 100;
  const L = clamp(l, 0, 100) / 100;
  if (S === 0) {
    const v = Math.round(L * 255);
    return { r: v, g: v, b: v };
  }
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
  const p = 2 * L - q;
  const hue = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return {
    r: Math.round(hue(H + 1 / 3) * 255),
    g: Math.round(hue(H) * 255),
    b: Math.round(hue(H - 1 / 3) * 255),
  };
}

export function fromHex(input: string): Swatch {
  const raw = input.replace("#", "").trim();
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  const n = Number.parseInt(full, 16);
  const rgb = { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  return { hex: rgbToHex(rgb), rgb, hsl: rgbToHsl(rgb) };
}

export function fromHsl(h: number, s: number, l: number): Swatch {
  const hsl = { h: hueNorm(h), s: clamp(Math.round(s), 0, 100), l: clamp(Math.round(l), 0, 100) };
  const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
  return { hex: rgbToHex(rgb), rgb, hsl };
}

export function formatRgb(rgb: Rgb) {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

export function formatHsl(hsl: Hsl) {
  return `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
}

export const SEED_PALETTE: Swatch[] = SEED_HEX.map(fromHex);

function channel(c: number) {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: Rgb) {
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastRatio(a: Rgb, b: Rgb) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

export function grade(ratio: number): Grade {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA lg";
  return "Fail";
}

function gradeHint(g: Grade) {
  switch (g) {
    case "AAA":
      return "Passes AAA, 7:1 or better for normal text";
    case "AA":
      return "Passes AA, 4.5:1 or better for normal text";
    case "AA lg":
      return "Passes AA for large text only, 3:1";
    default:
      return "Below 3:1 — fails WCAG text contrast";
  }
}

export function contrastReport(swatch: Swatch): {
  rows: ContrastRow[];
  best: "ink" | "paper";
  bestRgb: Rgb;
} {
  const dark = contrastRatio(swatch.rgb, INK);
  const light = contrastRatio(swatch.rgb, PAPER);
  const onCanvas = contrastRatio(swatch.rgb, CANVAS);
  const best = dark >= light ? "ink" : "paper";
  const row = (id: string, label: string, ratio: number): ContrastRow => {
    const g = grade(ratio);
    return { id, label, ratio, grade: g, hint: gradeHint(g) };
  };
  return {
    best,
    bestRgb: best === "ink" ? INK : PAPER,
    rows: [
      row("dark", "Dark text", dark),
      row("light", "Light text", light),
      row("canvas", "On canvas", onCanvas),
    ],
  };
}

export function toCssVariables(swatches: Swatch[]) {
  const lines = ["/* Chroma palette */", ":root {"];
  swatches.forEach((swatch, index) => {
    const n = index + 1;
    lines.push(`  --swatch-${n}: ${swatch.hex};`);
    lines.push(`  --swatch-${n}-rgb: ${swatch.rgb.r}, ${swatch.rgb.g}, ${swatch.rgb.b};`);
    lines.push(`  --swatch-${n}-hsl: ${swatch.hsl.h} ${swatch.hsl.s}% ${swatch.hsl.l}%;`);
  });
  lines.push("}");
  return lines.join("\n");
}

export function hexList(swatches: Swatch[]) {
  return swatches.map((swatch) => swatch.hex).join("\n");
}

function jitter(rng: () => number, amount: number) {
  return Math.round((rng() - 0.5) * 2 * amount);
}

function shuffle<T>(items: T[], rng: () => number) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = next[i] as T;
    next[i] = next[j] as T;
    next[j] = swap;
  }
  return next;
}

function hueDistance(a: number, b: number) {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

function anchorHue(current: Swatch[], locks: boolean[], rng: () => number) {
  const locked = current.filter((_, index) => locks[index]);
  if (locked.length === 0) return Math.floor(rng() * 360);
  return [...locked].sort((a, b) => b.hsl.s - a.hsl.s)[0]!.hsl.h;
}

function huesFor(harmony: Harmony, base: number, rng: () => number) {
  const shift = (offsets: number[], spread: number) =>
    offsets.map((offset) => hueNorm(base + offset + jitter(rng, spread)));
  switch (harmony) {
    case "analogous":
      return shift([-28, -14, 0, 14, 28], 6);
    case "complementary":
      return shift([0, 16, 180, 196, -22], 4);
    case "triadic":
      return shift([0, 120, 240, 14, 134], 4);
    case "split":
      return shift([0, 150, 210, 166, 194], 4);
    case "mono":
      return shift([0, 0, 0, 0, 0], 2);
    case "free":
      return shift([0, 0, 0, 0, 0], 0);
    default:
      return shift([0, 24, 48, 72, 96], 4);
  }
}

function rolesFor(harmony: Harmony, rng: () => number) {
  if (harmony === "mono") return ROLES;
  return shuffle(ROLES, rng);
}

function lerpHue(from: number, to: number, t: number) {
  const delta = ((to - from + 540) % 360) - 180;
  return hueNorm(from + delta * t);
}

function generateGradientPalette(rng: () => number, variant: number): Swatch[] {
  const start = Math.floor(rng() * 360);
  const spans = [36, 72, 118, 0, 156];
  const span = (spans[variant] ?? 72) * (rng() > 0.5 ? 1 : -1);
  const satStart = variant === 3 ? 58 : 64 + jitter(rng, 6);
  const satEnd = variant === 3 ? 36 : 72 + jitter(rng, 6);
  const lights = variant === 4 ? [40, 48, 56, 64, 72] : [16, 34, 52, 70, 88];
  return lights.map((light, index) => {
    const t = index / 4;
    return fromHsl(lerpHue(start, start + span, t), satStart + (satEnd - satStart) * t, light);
  });
}

/** Five full gradient palettes. The first one keeps any locked swatches. */
export function gradientChoices(current: Swatch[], locks: boolean[], rng: () => number = Math.random): Swatch[][] {
  const choices = [0, 1, 2, 3, 4].map((variant) => generateGradientPalette(rng, variant));
  const first = choices[0];
  if (!first) return choices;
  choices[0] = first.map((swatch, index) => (locks[index] ? (current[index] ?? swatch) : swatch));
  return choices;
}

export function generatePalette(
  harmony: Harmony,
  current: Swatch[],
  locks: boolean[],
  rng: () => number = Math.random,
): Swatch[] {
  if (harmony === "gradient") {
    return gradientChoices(current, locks, rng)[0] ?? current;
  }
  const roles = rolesFor(harmony, rng);
  const base = anchorHue(current, locks, rng);
  const planned = huesFor(harmony, base, rng);
  const next = current.map((swatch) => swatch);
  const taken: number[] = current.filter((_, index) => locks[index]).map((swatch) => swatch.hsl.h);

  for (let index = 0; index < 5; index += 1) {
    if (locks[index]) continue;
    const role = roles[index] ?? ROLES[index]!;
    let hue = planned[index] ?? base;
    if (harmony === "free") {
      hue = Math.floor(rng() * 360);
      for (let attempt = 0; attempt < 36; attempt += 1) {
        const candidate = Math.floor(rng() * 360);
        if (taken.every((used) => hueDistance(used, candidate) >= 28)) {
          hue = candidate;
          break;
        }
      }
    }
    let sat = clamp(role.s + jitter(rng, harmony === "mono" ? 4 : 8), harmony === "mono" ? 22 : 36, 92);
    let light = clamp(role.l + jitter(rng, 3), 8, 94);
    const clash = taken.some((used) => hueDistance(used, hue) < 14 && Math.abs(light - (current.find((s) => s.hsl.h === used)?.hsl.l ?? 50)) < 12);
    if (clash) light = clamp(light + (light > 50 ? -16 : 16), 8, 94);
    const swatch = fromHsl(hue, sat, light);
    taken.push(swatch.hsl.h);
    next[index] = swatch;
  }
  return next;
}

export function cloneSwatch(swatch: Swatch): Swatch {
  return {
    hex: swatch.hex,
    rgb: { ...swatch.rgb },
    hsl: { ...swatch.hsl },
  };
}
