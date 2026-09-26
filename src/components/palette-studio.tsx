import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { Check, ChevronDown, Copy, Download, Lock, Music, Shuffle, Undo2, Unlock } from "lucide-react";
import {
  CANVAS,
  HARMONIES,
  INK,
  PAPER,
  SEED_PALETTE,
  cloneSwatch,
  contrastRatio,
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

function loadSaved(): { palette: Swatch[]; locks: boolean[]; harmony: Harmony } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as {
      palette?: { hex?: string }[];
      locks?: boolean[];
      harmony?: string;
      platesOpen?: boolean;
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
      harmony: isHarmony(data.harmony) ? data.harmony : "complementary",
    };
  } catch {
    return null;
  }
}

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let next = Math.imul(state ^ (state >>> 15), 1 | state);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
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
  const [harmony, setHarmony] = useState<Harmony>("complementary");
  const [selected, setSelected] = useState(0);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [historyLen, setHistoryLen] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [gradients, setGradients] = useState<Swatch[][]>([]);
  const [activeGradient, setActiveGradient] = useState(0);
  const [openTip, setOpenTip] = useState<Harmony | null>(null);
  const [platesOpen, setPlatesOpen] = useState(false);
  const paletteRef = useRef(palette);
  const locksRef = useRef(locks);
  const harmonyRef = useRef(harmony);
  const modesRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const historyRef = useRef<Swatch[][]>([]);
  const sliderDirty = useRef(false);
  const toastTimer = useRef<number>(0);
  const platesStageRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const musicWanted = useRef(true);
  const [musicOn, setMusicOn] = useState(false);
  paletteRef.current = palette;
  locksRef.current = locks;
  harmonyRef.current = harmony;

  useLayoutEffect(() => {
    const nav = modesRef.current;
    const pill = pillRef.current;
    if (!nav || !pill) return;
    const id = openTip ?? harmony;
    const btn = nav.querySelector<HTMLButtonElement>(`[data-harmony="${id}"]`);
    if (!btn) return;
    const navBox = nav.getBoundingClientRect();
    const box = btn.getBoundingClientRect();
    pill.style.width = `${box.width}px`;
    pill.style.height = `${box.height}px`;
    pill.style.transform = `translate(${box.left - navBox.left - nav.clientLeft}px, ${box.top - navBox.top - nav.clientTop}px)`;
    const frame = requestAnimationFrame(() => nav.classList.add("is-ready"));
    return () => cancelAnimationFrame(frame);
  }, [openTip, harmony]);

  useEffect(() => {
    const onResize = () => {
      const nav = modesRef.current;
      const pill = pillRef.current;
      if (!nav || !pill) return;
      const id = openTip ?? harmonyRef.current;
      const btn = nav.querySelector<HTMLButtonElement>(`[data-harmony="${id}"]`);
      if (!btn) return;
      const navBox = nav.getBoundingClientRect();
      const box = btn.getBoundingClientRect();
      pill.style.width = `${box.width}px`;
      pill.style.height = `${box.height}px`;
      pill.style.transform = `translate(${box.left - navBox.left - nav.clientLeft}px, ${box.top - navBox.top - nav.clientTop}px)`;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [openTip]);

  const css = useMemo(() => toCssVariables(palette), [palette]);
  const selectedSwatch = palette[selected] ?? palette[0]!;
  const drafts = useMemo(() => {
    const seedBase = hashSeed(`${palette.map((swatch) => swatch.hex).join("")}|${locks.map((locked) => (locked ? "1" : "0")).join("")}`);
    const frames = {} as Record<Harmony, Swatch[]>;
    let gradientDrafts: Swatch[][] = [];
    for (const item of HARMONIES) {
      if (item.id === harmony) {
        frames[item.id] = palette;
        continue;
      }
      const rng = mulberry32(seedBase ^ hashSeed(item.id));
      if (item.id === "gradient") {
        gradientDrafts = gradientChoices(palette, locks, rng);
        frames.gradient = gradientDrafts[0] ?? palette;
      } else {
        frames[item.id] = generatePalette(item.id, palette, locks, rng);
      }
    }
    return { frames, gradientDrafts };
  }, [palette, locks, harmony]);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  useEffect(() => {
    const saved = loadSaved();
    if (saved) {
      setPalette(saved.palette);
      setLocks(saved.locks);
      setHarmony(saved.harmony);
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? (JSON.parse(raw) as { platesOpen?: boolean }) : null;
      if (data?.platesOpen) setPlatesOpen(true);
    } catch {
      /* keep the plates collapsed */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("chroma-music");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    musicWanted.current = reduce ? saved === "on" : saved !== "off";
    const audio = new Audio(`${import.meta.env.BASE_URL}lofi.mp3`);
    audio.loop = true;
    audio.volume = 0.22;
    audio.preload = "auto";
    audioRef.current = audio;

    const begin = () => {
      if (!musicWanted.current || !audio.paused) return;
      audio.play().then(() => setMusicOn(true)).catch(() => {});
    };
    const arm = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-music]")) return;
      begin();
    };
    const onHide = () => {
      if (document.hidden) {
        audio.pause();
        return;
      }
      if (musicWanted.current) begin();
    };
    window.addEventListener("pointerdown", arm, true);
    window.addEventListener("keydown", arm);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pointerdown", arm, true);
      window.removeEventListener("keydown", arm);
      document.removeEventListener("visibilitychange", onHide);
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ palette, locks, harmony, platesOpen }));
  }, [palette, locks, harmony, platesOpen, hydrated]);

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

  function toggleMusic() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      musicWanted.current = false;
      localStorage.setItem("chroma-music", "off");
      audio.pause();
      setMusicOn(false);
      return;
    }
    musicWanted.current = true;
    localStorage.setItem("chroma-music", "on");
    audio.play().then(() => setMusicOn(true)).catch(() => {});
  }

  function setPlates(next: boolean) {
    if (next === platesOpen) return;
    const stage = platesStageRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!stage || reduce) {
      setPlatesOpen(next);
      return;
    }
    const from = stage.getBoundingClientRect().height;
    flushSync(() => setPlatesOpen(next));
    const to = stage.getBoundingClientRect().height;
    if (Math.abs(to - from) < 1) return;
    stage.style.overflow = "hidden";
    stage.style.transition = "none";
    stage.style.height = `${from}px`;
    void stage.offsetHeight;
    stage.style.transition = "height 0.48s cubic-bezier(0.22, 1, 0.36, 1)";
    stage.style.height = `${to}px`;
    const done = (event: TransitionEvent) => {
      if (event.propertyName !== "height") return;
      stage.style.height = "";
      stage.style.overflow = "";
      stage.style.transition = "";
      stage.removeEventListener("transitionend", done);
    };
    stage.addEventListener("transitionend", done);
  }

  function selectHarmony(next: Harmony) {
    if (next === harmonyRef.current) {
      shuffle();
      return;
    }
    const draft = draftsRef.current.frames[next] ?? paletteRef.current;
    setHarmony(next);
    if (next === "gradient") {
      const choices =
        draftsRef.current.gradientDrafts.length > 0
          ? draftsRef.current.gradientDrafts
          : gradientChoices(paletteRef.current, locksRef.current);
      setGradients(choices.map((row) => row.map(cloneSwatch)));
      setActiveGradient(0);
      if (locksRef.current.every(Boolean)) return;
      pushHistory();
      setPalette((choices[0] ?? draft).map(cloneSwatch));
      return;
    }
    if (locksRef.current.every(Boolean)) return;
    pushHistory();
    setPalette(draft.map(cloneSwatch));
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
          <div
            className="modes"
            role="toolbar"
            aria-label="Harmony"
            ref={modesRef}
            onPointerLeave={() => setOpenTip(null)}
            onBlur={(event) => {
              const next = event.relatedTarget;
              if (next instanceof Node && event.currentTarget.contains(next)) return;
              setOpenTip(null);
            }}
          >
            <span className="mode-pill" ref={pillRef} aria-hidden />
            {HARMONIES.map((item) => (
              <span key={item.id} className="mode-wrap" onPointerEnter={() => setOpenTip(item.id)}>
                <button
                  type="button"
                  className="mode"
                  data-harmony={item.id}
                  aria-pressed={harmony === item.id}
                  aria-describedby={`harmony-tip-${item.id}`}
                  onFocus={() => setOpenTip(item.id)}
                  onClick={() => selectHarmony(item.id)}
                >
                  {item.label}
                </button>
                <span
                  className="mode-tip"
                  id={`harmony-tip-${item.id}`}
                  role="tooltip"
                  data-open={openTip === item.id ? "true" : "false"}
                >
                  <span className={item.id === "gradient" ? "tip-frames tip-frames-ramp" : "tip-frames"} aria-hidden>
                    {(drafts.frames[item.id] ?? palette).map((swatch, index) => (
                      <span key={index} className="tip-frame" style={{ backgroundColor: swatch.hex }} />
                    ))}
                  </span>
                  <span className="tip-copy">{item.tip}</span>
                </span>
              </span>
            ))}
          </div>
          <div className="nav-actions">
            <button
              type="button"
              className="icon-btn music-btn"
              data-music
              aria-pressed={musicOn}
              aria-label={musicOn ? "Pause chill music" : "Play chill music"}
              onClick={toggleMusic}
            >
              <Music />
            </button>
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
        <section className={harmony === "gradient" && gradients.length > 0 ? "stage has-ramps" : "stage"}>
          <div className="intro-copy">
            <p className="eyebrow">Palette studio</p>
            <h1>
              Five colors.
              <br />
              Lock what you love.
            </h1>
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
          <section className="tune-dock" aria-label="Adjust selected swatch">
            <div className="tune-head">
              <p className="kind">Fine tune</p>
              <div className="tune-picks" role="group" aria-label="Choose swatch">
                {palette.map((swatch, index) => (
                  <button
                    key={index}
                    type="button"
                    className="tune-pick"
                    style={{ backgroundColor: swatch.hex, color: swatch.hsl.l > 62 ? "#0B1220" : "#fff" }}
                    aria-pressed={selected === index}
                    aria-label={`Fine tune swatch ${index + 1}`}
                    onClick={() => setSelected(index)}
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
              <span className="tune-hex">{selectedSwatch.hex}</span>
            </div>
            <div className="sliders tune-sliders">
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
                  Sat <b>{selectedSwatch.hsl.s}%</b>
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
                  Light <b>{selectedSwatch.hsl.l}%</b>
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
        </section>

        <section className="plates" data-open={platesOpen ? "true" : "false"}>
          <div className="grid-head">
            <button
              type="button"
              className="btn-text plates-unlock"
              onClick={unlockAll}
              disabled={lockedCount === 0}
            >
              {lockedCount === 0 ? "All unlocked" : `Unlock ${lockedCount}`}
            </button>
            <button
              type="button"
              className="plates-toggle"
              aria-expanded={platesOpen}
              onClick={() => setPlates(!platesOpen)}
            >
              {platesOpen ? "Hide values" : "Expand colors"}
              <ChevronDown />
            </button>
          </div>

          <div className="plates-stage" ref={platesStageRef}>
            {platesOpen ? (
              <div className="plates-view swatch-grid" key="open">
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
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <button
                type="button"
                className="plates-view plates-strip"
                key="shut"
                aria-label="Expand colors"
                onClick={() => setPlates(true)}
              >
                {palette.map((swatch, index) => (
                  <span key={index} className="plates-chip" style={{ backgroundColor: swatch.hex }}>
                    <span>{index + 1}</span>
                    {locks[index] ? <span className="rail-lock" /> : null}
                  </span>
                ))}
              </button>
            )}
          </div>
        </section>

        <PaletteUses palette={palette} gradient={harmony === "gradient"} />

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

function inkFor(bg: Swatch, options: Swatch[]) {
  let bestHex = options[0]?.hex ?? "#E8EEF9";
  let best = 0;
  for (const option of options) {
    const score = contrastRatio(bg.rgb, option.rgb);
    if (score > best) {
      best = score;
      bestHex = option.hex;
    }
  }
  if (best >= 4.5) return bestHex;
  return contrastRatio(bg.rgb, PAPER) >= contrastRatio(bg.rgb, INK) ? "#E8EEF9" : "#0B1220";
}

function fieldInk(swatch: Swatch) {
  return swatch.hsl.l > 58 ? "#16141f" : "#f6f3ff";
}

function GradientIdeas({ palette }: { palette: Swatch[] }) {
  const [a, b, c, d, e] = palette;
  const s0 = a ?? palette[0]!;
  const s1 = b ?? s0;
  const s2 = c ?? s1;
  const s3 = d ?? s2;
  const s4 = e ?? s3;
  const tone = {
    "--s0": s0.hex,
    "--s1": s1.hex,
    "--s2": s2.hex,
    "--s3": s3.hex,
    "--s4": s4.hex,
  } as CSSProperties;
  const onDark = fieldInk(s0);
  const onLight = fieldInk(s4);

  return (
    <section className="uses" aria-label="Gradient design suggestions">
      <div className="use-board">
        <div className="use-lane">
          <div className="use-lane-head">
            <span className="use-mark" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <h2>Slides</h2>
          </div>
          <div className="slide-row">
            <figure className="use-card">
              <div className="use-frame grad-aurora" style={{ ...tone, color: onDark }}>
                <i className="glow g1" />
                <i className="glow g2" />
                <div className="grad-copy">
                  <strong>
                    Open
                    <br />
                    <em>the room</em>
                  </strong>
                  <p>Where this ramp begins.</p>
                </div>
              </div>
              <figcaption>Aurora field</figcaption>
            </figure>
            <figure className="use-card">
              <div className="use-frame grad-waves" style={{ ...tone, color: onLight }}>
                <svg className="wave-svg" viewBox="0 0 400 225" preserveAspectRatio="none" aria-hidden>
                  <defs>
                    <linearGradient id="wave-deep" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor={s0.hex} />
                      <stop offset="1" stopColor={s2.hex} />
                    </linearGradient>
                    <linearGradient id="wave-soft" x1="1" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor={s2.hex} />
                      <stop offset="1" stopColor={s3.hex} />
                    </linearGradient>
                  </defs>
                  <path d="M0 92 C70 40 130 150 210 98 C290 46 340 70 400 48 V225 H0 Z" fill="url(#wave-deep)" />
                  <path d="M0 150 C90 112 170 196 260 146 C330 110 370 128 400 118 V225 H0 Z" fill="url(#wave-soft)" opacity="0.95" />
                </svg>
                <div className="grad-copy top">
                  <strong>Soft current</strong>
                  <p>Two waves, one ramp.</p>
                </div>
              </div>
              <figcaption>Flowing waves</figcaption>
            </figure>
            <figure className="use-card">
              <div className="use-frame grad-orbs" style={{ ...tone, color: onDark }}>
                <i className="blob b1" />
                <i className="blob b2" />
                <i className="blob b3" />
                <div className="grad-copy end">
                  <strong>In motion</strong>
                  <p>Overlapping stops.</p>
                </div>
              </div>
              <figcaption>Overlapping orbs</figcaption>
            </figure>
          </div>
        </div>
        <div className="use-lane">
          <div className="use-lane-head">
            <span className="use-window" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <h2>Website</h2>
          </div>
          <div className="site-row">
            <figure className="use-card">
              <div className="use-frame grad-hero" style={{ ...tone, color: onDark }}>
                <i className="glow g2" />
                <header>
                  <b />
                  <span>North</span>
                  <nav>
                    <i />
                    <i />
                    <i />
                  </nav>
                  <em>Enter</em>
                </header>
                <div className="grad-copy">
                  <strong>
                    A page that
                    <br />
                    <em>fades, not blocks</em>
                  </strong>
                  <p>Nav, headline, and one action on the same wash.</p>
                </div>
              </div>
              <figcaption>Gradient hero</figcaption>
            </figure>
            <figure className="use-card">
              <div className="use-frame grad-glass" style={{ ...tone, color: onLight }}>
                <i className="blob b1" />
                <i className="blob b2" />
                <div className="glass-card">
                  <strong>Stay in the wash</strong>
                  <p>A glass panel over the ramp, not a new color.</p>
                  <span>
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              </div>
              <figcaption>Glass on a wash</figcaption>
            </figure>
          </div>
        </div>
      </div>
    </section>
  );
}

function PaletteUses({ palette, gradient }: { palette: Swatch[]; gradient: boolean }) {
  if (gradient) return <GradientIdeas palette={palette} />;
  const ranked = [...palette].sort((a, b) => a.hsl.l - b.hsl.l);
  const bg = ranked[0] ?? palette[0]!;
  const surface = ranked[1] ?? bg;
  const mid = ranked[2] ?? surface;
  const soft = ranked[3] ?? mid;
  const paper = ranked[4] ?? soft;
  const on = (color: Swatch) => inkFor(color, ranked);
  const tone = {
    "--c-bg": bg.hex,
    "--c-surface": surface.hex,
    "--c-mid": mid.hex,
    "--c-soft": soft.hex,
    "--c-paper": paper.hex,
    "--c-on-bg": on(bg),
    "--c-on-surface": on(surface),
    "--c-on-mid": on(mid),
    "--c-on-soft": on(soft),
    "--c-on-paper": on(paper),
  } as CSSProperties;

  return (
    <section className="uses" aria-label="Suggested designs">
      <div className="use-board">
        <div className="use-lane">
          <div className="use-lane-head">
            <span className="use-mark" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <h2>Slides</h2>
          </div>
          <div className="slide-row">
            <figure className="use-card">
              <div className="use-frame deck-cover" style={{ ...tone, background: bg.hex, color: on(bg) }}>
                <div className="deck-copy">
                  <span>Pitch</span>
                  <strong>
                    Business
                    <br />
                    presentation
                  </strong>
                  <p>A yearly story, told in one opening frame.</p>
                  <em>Company · 2026</em>
                </div>
                <div className="orbit" aria-hidden>
                  <i className="ring" />
                  <i className="ring inner" />
                  <i className="wedge" />
                  <b>
                    <svg viewBox="0 0 24 24" width="18" height="18">
                      <path d="M3 11.2 21 3l-7.2 18-2.4-7.4z" fill="currentColor" />
                    </svg>
                  </b>
                </div>
              </div>
              <figcaption>Cover · title and target</figcaption>
            </figure>
            <figure className="use-card">
              <div className="use-frame deck-growth" style={{ ...tone, background: paper.hex, color: on(paper) }}>
                <div className="stat-col">
                  {[
                    ["28%", "Now"],
                    ["54%", "Year"],
                    ["19%", "Next"],
                  ].map(([value, label]) => (
                    <span key={label}>
                      <b>{value}</b>
                      {label}
                    </span>
                  ))}
                </div>
                <div className="curve-panel">
                  <strong>Growth line</strong>
                  <ul>
                    <li>New markets</li>
                    <li>Repeat use</li>
                    <li>Retention</li>
                  </ul>
                </div>
              </div>
              <figcaption>Stats beside a curve</figcaption>
            </figure>
            <figure className="use-card">
              <div className="use-frame deck-story" style={{ ...tone, background: surface.hex, color: on(surface) }}>
                <header>
                  <strong>History</strong>
                  <span>Story of the day</span>
                </header>
                <ol>
                  <li>
                    <b>01</b> Direction
                  </li>
                  <li>
                    <b>02</b> Product
                  </li>
                  <li>
                    <b>03</b> Launch
                  </li>
                </ol>
                <blockquote>
                  <span>“</span>
                  Make the first screen feel inevitable.
                </blockquote>
              </div>
              <figcaption>List and quote</figcaption>
            </figure>
          </div>
        </div>
        <div className="use-lane">
          <div className="use-lane-head">
            <span className="use-window" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <h2>Website</h2>
          </div>
          <div className="site-row">
            <figure className="use-card">
              <div className="use-frame site-landing" style={{ ...tone, background: paper.hex, color: on(paper) }}>
                <header>
                  <b />
                  <span>Studio</span>
                  <nav>
                    <i />
                    <i />
                    <i />
                    <i />
                  </nav>
                  <em>Book</em>
                  <strong>Start</strong>
                </header>
                <div className="site-hero">
                  <h3>
                    Build tomorrow’s
                    <br />
                    landscape today
                  </h3>
                  <p>A clear offer, a short proof line, and one action above the fold.</p>
                </div>
                <div className="site-media">
                  <span className="float-card">
                    <b>Feature</b>
                    Open the work
                  </span>
                </div>
              </div>
              <figcaption>Landing · nav, headline, media</figcaption>
            </figure>
            <figure className="use-card">
              <div className="use-frame site-product" style={{ ...tone, background: soft.hex, color: on(soft) }}>
                <header>
                  <b />
                  <span>Payr</span>
                  <nav>
                    <i />
                    <i />
                    <i />
                  </nav>
                  <em>Log in</em>
                  <strong>Sign up</strong>
                </header>
                <div className="product-hero">
                  <h3>Pay attention to the work.</h3>
                  <p>Earn clarity. Stay in control.</p>
                  <button type="button">Get started</button>
                </div>
                <div className="product-cards">
                  {["Lock", "Check", "Export"].map((label) => (
                    <span key={label}>
                      <i />
                      {label}
                    </span>
                  ))}
                </div>
              </div>
              <figcaption>Product · centered offer and cards</figcaption>
            </figure>
          </div>
        </div>
      </div>
    </section>
  );
}

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
