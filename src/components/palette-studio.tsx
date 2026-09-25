import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, Lock, Shuffle, Undo2, Unlock } from "lucide-react";
import {
  CANVAS,
  HARMONIES,
  INK,
  PAPER,
  SEED_PALETTE,
  cloneSwatch,
  contrastReport,
  formatHsl,
  formatRgb,
  fromHex,
  fromHsl,
  generatePalette,
  gradientChoices,
  hexList,
  isHarmony,
  toCssVariables,
  type Harmony,
  type Swatch,
} from "@/lib/palette";

const STORAGE_KEY = "chroma-studio-v1";

type Notice = { message: string; dot: string };

function rgbCss(rgb: { r: number; g: number; b: number }) {
  return `rgb(${rgb.r} ${rgb.g} ${rgb.b})`;
}

function gradeClass(grade: string) {
  if (grade === "AAA") return "grade grade-aaa";
  if (grade === "AA") return "grade grade-aa";
  if (grade === "AA lg") return "grade grade-lg";
  return "grade grade-fail";
}

function loadSaved(): { palette: Swatch[]; locks: boolean[]; harmony: Harmony } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as {
      palette?: { hex?: string }[];
      locks?: boolean[];
      harmony?: string;
    };
    if (!Array.isArray(data.palette) || data.palette.length !== 5) return null;
    if (!data.palette.every((item) => typeof item.hex === "string" && /^#[0-9A-Fa-f]{6}$/.test(item.hex))) {
      return null;
    }
    return {
      palette: data.palette.map((item) => fromHex(item.hex as string)),
      locks:
        Array.isArray(data.locks) && data.locks.length === 5
          ? data.locks.map(Boolean)
          : [false, false, false, false, false],
      harmony: isHarmony(data.harmony) ? data.harmony : "analogous",
    };
  } catch {
    return null;
  }
}

function fallbackCopy(value: string) {
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

export function PaletteStudio() {
  const [palette, setPalette] = useState<Swatch[]>(SEED_PALETTE);
  const [locks, setLocks] = useState<boolean[]>([false, false, false, false, false]);
  const [harmony, setHarmony] = useState<Harmony>("analogous");
  const [selected, setSelected] = useState(0);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [historyLen, setHistoryLen] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [gradients, setGradients] = useState<Swatch[][]>([]);
  const [activeGradient, setActiveGradient] = useState(0);
  const paletteRef = useRef(palette);
  const locksRef = useRef(locks);
  const harmonyRef = useRef(harmony);
  const historyRef = useRef<Swatch[][]>([]);
  const sliderDirty = useRef(false);
  const toastTimer = useRef<number>(0);
  paletteRef.current = palette;
  locksRef.current = locks;
  harmonyRef.current = harmony;

  const css = useMemo(() => toCssVariables(palette), [palette]);
  const selectedSwatch = palette[selected] ?? palette[0]!;

  useEffect(() => {
    const saved = loadSaved();
    if (saved) {
      setPalette(saved.palette);
      setLocks(saved.locks);
      setHarmony(saved.harmony);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ palette, locks, harmony }));
  }, [palette, locks, harmony, hydrated]);

  useEffect(() => {
    if (!hydrated || harmony !== "gradient") return;
    setGradients((current) => {
      if (current.length > 0) return current;
      const made = gradientChoices(paletteRef.current, locksRef.current);
      made[0] = paletteRef.current.map(cloneSwatch);
      return made;
    });
  }, [hydrated, harmony]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        shuffle();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key >= "1" && key <= "5") {
        event.preventDefault();
        toggleLock(Number(key) - 1);
        return;
      }
      if (key === "c") {
        event.preventDefault();
        copyCss();
      } else if (key === "h") {
        event.preventDefault();
        copyHexes();
      } else if (key === "z") {
        event.preventDefault();
        undo();
      } else if (key === "u") {
        event.preventDefault();
        unlockAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Handlers read refs so the listener stays stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pushHistory() {
    historyRef.current = [...historyRef.current.slice(-30), paletteRef.current.map(cloneSwatch)];
    setHistoryLen(historyRef.current.length);
  }

  function flash(message: string, key: string, dot = rgbCss(CYAN_DOT)) {
    setCopiedKey(key);
    setNotice({ message, dot });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setCopiedKey(null);
      setNotice(null);
    }, 900);
  }

  function copyText(value: string, key: string, message: string, dot?: string) {
    flash(message, key, dot);
    const writer = navigator.clipboard?.writeText.bind(navigator.clipboard);
    if (writer) {
      void writer(value).catch(() => fallbackCopy(value));
      return;
    }
    fallbackCopy(value);
  }

  function shuffle() {
    if (locksRef.current.every(Boolean)) {
      flash("All five are locked", "locked");
      return;
    }
    pushHistory();
    if (harmonyRef.current === "gradient") {
      const choices = gradientChoices(paletteRef.current, locksRef.current);
      setGradients(choices);
      setActiveGradient(0);
      setPalette(choices[0] ?? paletteRef.current);
      return;
    }
    setPalette(generatePalette(harmonyRef.current, paletteRef.current, locksRef.current));
  }

  function undo() {
    const history = historyRef.current;
    if (history.length === 0) {
      flash("Nothing to undo", "undo");
      return;
    }
    const prev = history[history.length - 1];
    historyRef.current = history.slice(0, -1);
    setHistoryLen(historyRef.current.length);
    if (prev) setPalette(prev);
  }

  function toggleLock(index: number) {
    setSelected(index);
    setLocks((current) => current.map((locked, i) => (i === index ? !locked : locked)));
  }

  function unlockAll() {
    setLocks([false, false, false, false, false]);
    flash("Unlocked all swatches", "unlock");
  }

  function selectHarmony(next: Harmony) {
    setHarmony(next);
    if (next === "gradient") {
      const choices = gradientChoices(paletteRef.current, locksRef.current);
      setGradients(choices);
      setActiveGradient(0);
      if (locksRef.current.every(Boolean)) return;
      pushHistory();
      setPalette(choices[0] ?? paletteRef.current);
      return;
    }
    if (locksRef.current.every(Boolean)) return;
    pushHistory();
    setPalette(generatePalette(next, paletteRef.current, locksRef.current));
  }

  function applyGradient(index: number) {
    const choice = gradients[index];
    if (!choice) return;
    pushHistory();
    setActiveGradient(index);
    setPalette(choice.map(cloneSwatch));
  }

  function copyCss() {
    copyText(toCssVariables(paletteRef.current), "css", "Copied CSS variables");
  }

  function copyHexes() {
    copyText(hexList(paletteRef.current), "hexes", "Copied 5 hex values");
  }

  function downloadCss() {
    const text = toCssVariables(paletteRef.current);
    const blob = new Blob([text], { type: "text/css" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "chroma-palette.css";
    link.click();
    URL.revokeObjectURL(url);
    flash("Downloaded chroma-palette.css", "download");
  }

  function beginSliderEdit() {
    if (sliderDirty.current) return;
    sliderDirty.current = true;
    pushHistory();
  }

  function updateChannel(channel: "h" | "s" | "l", value: number) {
    beginSliderEdit();
    setPalette((current) =>
      current.map((swatch, index) => {
        if (index !== selected) return swatch;
        return fromHsl(
          channel === "h" ? value : swatch.hsl.h,
          channel === "s" ? value : swatch.hsl.s,
          channel === "l" ? value : swatch.hsl.l,
        );
      }),
    );
  }

  const lockedCount = locks.filter(Boolean).length;
  const satTrack = `linear-gradient(90deg, hsl(${selectedSwatch.hsl.h} 0% ${selectedSwatch.hsl.l}%), hsl(${selectedSwatch.hsl.h} 100% ${selectedSwatch.hsl.l}%))`;
  const lightTrack = `linear-gradient(90deg, hsl(${selectedSwatch.hsl.h} ${selectedSwatch.hsl.s}% 8%), hsl(${selectedSwatch.hsl.h} ${selectedSwatch.hsl.s}% 52%), hsl(${selectedSwatch.hsl.h} ${selectedSwatch.hsl.s}% 96%))`;

  return (
    <>
      <header className="nav-bar">
        <div className="nav-inner">
          <a className="brand" href="#palette">
            <span className="brand-dot" aria-hidden />
            <span className="brand-name">Chroma</span>
          </a>
          <div className="modes" role="toolbar" aria-label="Harmony">
            {HARMONIES.map((item) => (
              <span key={item.id} className="mode-wrap">
                <button
                  type="button"
                  className="mode"
                  aria-pressed={harmony === item.id}
                  aria-describedby={`harmony-tip-${item.id}`}
                  onClick={() => selectHarmony(item.id)}
                >
                  {item.label}
                </button>
                <span className="mode-tip" id={`harmony-tip-${item.id}`} role="tooltip">
                  {item.tip}
                </span>
              </span>
            ))}
          </div>
          <div className="nav-actions">
            <button type="button" className="icon-btn" onClick={undo} disabled={historyLen === 0} aria-label="Undo">
              <Undo2 />
            </button>
            <button type="button" className="btn btn-primary" onClick={shuffle}>
              <Shuffle />
              Shuffle
            </button>
          </div>
        </div>
      </header>

      <main className="wrap" id="palette">
        <section className={harmony === "gradient" && gradients.length > 0 ? "intro intro-split" : "intro"}>
          <div>
            <p className="eyebrow">Palette studio</p>
            <h1>Five colors. Lock what you love.</h1>
            <p className="sub">
              Space shuffles everything that is not locked. Click a hex, RGB, or HSL value to copy it.
              Contrast is checked against dark text, light text, and the canvas.
            </p>
          </div>
          {harmony === "gradient" && gradients.length > 0 ? (
            <aside className="ramp-dock" aria-label="Gradient palettes">
              <p className="kind">Pick a ramp</p>
              <div className="gradient-list">
                {gradients.map((stops, index) => (
                  <button
                    key={index}
                    type="button"
                    className="gradient-pick"
                    aria-pressed={activeGradient === index}
                    aria-label={`Use gradient palette ${index + 1}`}
                    onClick={() => applyGradient(index)}
                  >
                    <span className="gradient-index">{index + 1}</span>
                    <span
                      className="gradient-bar"
                      style={{ background: `linear-gradient(90deg, ${stops.map((swatch) => swatch.hex).join(", ")})` }}
                    />
                  </button>
                ))}
              </div>
            </aside>
          ) : null}
        </section>

        <div className="palette-rail" role="group" aria-label="All five swatches">
          {palette.map((swatch, index) => (
            <button
              key={index}
              type="button"
              className="rail-swatch"
              style={{ backgroundColor: swatch.hex }}
              aria-pressed={selected === index}
              aria-label={`Show swatch ${index + 1}, ${swatch.hex}${locks[index] ? ", locked" : ""}`}
              onClick={() => {
                setSelected(index);
                document.getElementById(`swatch-${index + 1}`)?.scrollIntoView({ block: "nearest" });
              }}
            >
              {locks[index] ? <span className="rail-lock" /> : null}
            </button>
          ))}
        </div>

        <div className="grid-head">
          <p className="kind">{lockedCount === 0 ? "None locked" : `${lockedCount} locked`}</p>
          <button type="button" className="btn-text" onClick={unlockAll}>
            Unlock all
          </button>
        </div>

        <div className="swatch-grid">
          {palette.map((swatch, index) => {
            const report = contrastReport(swatch);
            const text = rgbCss(report.bestRgb);
            const ratioLabel = `${Math.max(report.rows[0]!.ratio, report.rows[1]!.ratio).toFixed(2)}:1`;
            return (
              <article
                key={index}
                id={`swatch-${index + 1}`}
                className="swatch"
                data-locked={locks[index] ? "true" : "false"}
                data-selected={selected === index ? "true" : "false"}
              >
                <div
                  className="swatch-color"
                  style={{ backgroundColor: swatch.hex, color: text }}
                  onClick={() => setSelected(index)}
                >
                  <span className="swatch-index">{index + 1}</span>
                  <button
                    type="button"
                    className="lock-btn"
                    aria-pressed={locks[index]}
                    aria-label={`${locks[index] ? "Unlock" : "Lock"} swatch ${index + 1}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleLock(index);
                    }}
                  >
                    <LockGlyph locked={Boolean(locks[index])} />
                  </button>
                  <span className="sample">
                    <span className="sample-aa">Aa</span>
                    <span className="sample-meta">
                      {report.best === "ink" ? "Dark text" : "Light text"} · {ratioLabel}
                    </span>
                  </span>
                </div>
                <div className="swatch-body">
                  <CopyValue
                    kicker="Hex"
                    value={swatch.hex}
                    copied={copiedKey === `hex-${index}`}
                    onCopy={() => {
                      setSelected(index);
                      copyText(swatch.hex, `hex-${index}`, `Copied ${swatch.hex}`, swatch.hex);
                    }}
                  />
                  <CopyValue
                    kicker="RGB"
                    value={formatRgb(swatch.rgb)}
                    copied={copiedKey === `rgb-${index}`}
                    onCopy={() => {
                      setSelected(index);
                      copyText(formatRgb(swatch.rgb), `rgb-${index}`, `Copied ${formatRgb(swatch.rgb)}`, swatch.hex);
                    }}
                  />
                  <CopyValue
                    kicker="HSL"
                    value={formatHsl(swatch.hsl)}
                    copied={copiedKey === `hsl-${index}`}
                    onCopy={() => {
                      setSelected(index);
                      copyText(formatHsl(swatch.hsl), `hsl-${index}`, `Copied ${formatHsl(swatch.hsl)}`, swatch.hex);
                    }}
                  />
                  <ul className="contrast">
                    {report.rows.map((row) => (
                      <li key={row.id}>
                        <span>{row.label}</span>
                        <span className="ratio">{row.ratio.toFixed(2)}</span>
                        <span className={gradeClass(row.grade)} title={row.hint}>
                          {row.grade}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            );
          })}
        </div>

        <section className="panel" aria-label="Adjust selected swatch">
          <div className="panel-head">
            <div>
              <p className="kind">Swatch {selected + 1}</p>
              <h2>Fine tune</h2>
            </div>
            <span className="sample-meta" style={{ color: "var(--color-muted)" }}>
              {selectedSwatch.hex}
            </span>
          </div>
          <div className="sliders">
            <label>
              <span className="slider-label">
                Hue <b>{selectedSwatch.hsl.h}</b>
              </span>
              <span className="slider-wrap">
                <span className="slider-track" />
                <input
                  className="slider"
                  type="range"
                  min={0}
                  max={360}
                  value={selectedSwatch.hsl.h}
                  aria-label="Hue"
                  onFocus={() => {
                    sliderDirty.current = false;
                  }}
                  onBlur={() => {
                    sliderDirty.current = false;
                  }}
                  onChange={(event) => updateChannel("h", Number(event.target.value))}
                />
              </span>
            </label>
            <label>
              <span className="slider-label">
                Saturation <b>{selectedSwatch.hsl.s}%</b>
              </span>
              <span className="slider-wrap">
                <span className="slider-track" style={{ background: satTrack }} />
                <input
                  className="slider"
                  type="range"
                  min={0}
                  max={100}
                  value={selectedSwatch.hsl.s}
                  aria-label="Saturation"
                  onFocus={() => {
                    sliderDirty.current = false;
                  }}
                  onBlur={() => {
                    sliderDirty.current = false;
                  }}
                  onChange={(event) => updateChannel("s", Number(event.target.value))}
                />
              </span>
            </label>
            <label>
              <span className="slider-label">
                Lightness <b>{selectedSwatch.hsl.l}%</b>
              </span>
              <span className="slider-wrap">
                <span className="slider-track" style={{ background: lightTrack }} />
                <input
                  className="slider"
                  type="range"
                  min={0}
                  max={100}
                  value={selectedSwatch.hsl.l}
                  aria-label="Lightness"
                  onFocus={() => {
                    sliderDirty.current = false;
                  }}
                  onBlur={() => {
                    sliderDirty.current = false;
                  }}
                  onChange={(event) => updateChannel("l", Number(event.target.value))}
                />
              </span>
            </label>
          </div>
        </section>

        <section className="panel" aria-label="CSS variables">
          <div className="panel-head">
            <div>
              <p className="kind">Export</p>
              <h2>CSS variables</h2>
            </div>
            <div className="export-actions">
              <button type="button" className="btn btn-outline" onClick={copyCss}>
                {copiedKey === "css" ? <Check /> : <Copy />}
                {copiedKey === "css" ? "Copied" : "Copy CSS"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={copyHexes}>
                {copiedKey === "hexes" ? <Check /> : <Copy />}
                Hex list
              </button>
              <button type="button" className="btn btn-ghost" onClick={downloadCss}>
                <Download />
                Download
              </button>
            </div>
          </div>
          <pre className="css-block">
            <code>{css}</code>
          </pre>
        </section>

        <ul className="keys">
          <li>
            <kbd>Space</kbd> Shuffle
          </li>
          <li>
            <kbd>1</kbd>–<kbd>5</kbd> Lock
          </li>
          <li>
            <kbd>C</kbd> Copy CSS
          </li>
          <li>
            <kbd>H</kbd> Copy hex
          </li>
          <li>
            <kbd>Z</kbd> Undo
          </li>
          <li>
            <kbd>U</kbd> Unlock all
          </li>
        </ul>
        <p className="sub" style={{ marginTop: 10 }}>
          WCAG 2.2. AA is 4.5:1 for normal text, 3:1 for large. Canvas is {rgbCss(CANVAS)}. Dark text is{" "}
          {rgbCss(INK)}. Light text is {rgbCss(PAPER)}.
        </p>
      </main>

      <div className={notice ? "toast show" : "toast"} role="status" aria-live="polite">
        <span className="toast-dot" style={notice ? { background: notice.dot } : undefined} />
        <span>{notice?.message ?? ""}</span>
      </div>
    </>
  );
}

const CYAN_DOT = { r: 34, g: 211, b: 238 };

function LockGlyph({ locked }: { locked: boolean }) {
  return (
    <span className="lock-ico" aria-hidden>
      <Lock className={locked ? "lock-on" : "lock-off"} />
      <Unlock className={locked ? "lock-off" : "lock-on"} />
    </span>
  );
}

function CopyValue({
  kicker,
  value,
  copied,
  onCopy,
}: {
  kicker: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <button type="button" className={copied ? "val is-copied" : "val"} onClick={onCopy} aria-label={`Copy ${kicker} ${value}`}>
      <span className="val-k">{copied ? "Copied" : kicker}</span>
      <span className="val-v">{value}</span>
      {copied ? <Check /> : <Copy />}
    </button>
  );
}
