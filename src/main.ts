import "./style.css";

type Mode = "play" | "add";
type Quality = "major" | "minor" | "diminished";
type Variant = "triad" | "seventh" | "sixth" | "sus2" | "sus4" | "add9";

type Harmony = {
  numeral: string;
  root: number;
  quality: Quality;
  variant: Variant;
  register: number;
  notes?: number[];
  duration: number;
  voicing: number;
};

const keyChoices = [
  "C major", "G major", "D major", "A major", "E major", "B major", "F# major",
  "F major", "Bb major", "Eb major", "Ab major", "Db major",
  "A minor", "E minor", "B minor", "F# minor", "C# minor", "D minor", "Eb minor", "F minor", "G minor", "Ab minor", "Bb minor", "C minor",
];
const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR_NUMERALS = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
const MINOR_NUMERALS = ["i", "ii°", "III", "iv", "v", "VI", "VII"];
const MAJOR_QUALITIES: Quality[] = ["major", "minor", "minor", "major", "major", "minor", "diminished"];
const MINOR_QUALITIES: Quality[] = ["minor", "diminished", "major", "minor", "minor", "major", "major"];
const STORAGE_KEY = "roman-playground-state";

let selectedKey = "C major";
let mode: Mode = "play";
let progression: Harmony[] = [];
let isLooping = false;
let loopTimer: number | undefined;
let contextMenuIndex: number | null = null;
let showAbout = false;
let volume = 0.65;
let tempo = 88;
let audioContext: AudioContext | undefined;
let masterGain: GainNode | undefined;

const app = document.querySelector<HTMLDivElement>("#app")!;

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedKey, mode, progression, volume, tempo }));
  } catch { /* Storage can be unavailable in a private browser context. */ }
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<{ selectedKey: string; mode: Mode; progression: Harmony[]; volume: number; tempo: number }> | null;
    if (!saved) return;
    if (saved.selectedKey && keyChoices.includes(saved.selectedKey)) selectedKey = saved.selectedKey;
    if (saved.mode === "play" || saved.mode === "add") mode = saved.mode;
    if (Array.isArray(saved.progression)) progression = saved.progression.map(chord => ({ ...chord, voicing: Number(chord.voicing) || 0 }));
    if (typeof saved.volume === "number") volume = Math.min(1, Math.max(0, saved.volume));
    if (typeof saved.tempo === "number") tempo = Math.min(240, Math.max(40, saved.tempo));
  } catch { /* Ignore malformed or old browser storage. */ }
}

// Render replaces the UI, so keep this one delegated listener on the stable app root.
app.addEventListener("click", event => {
  const target = event.target as Element;
  if (contextMenuIndex !== null && !target.closest(".context-menu, [data-menu-index]")) {
    contextMenuIndex = null;
    render();
  }
});

function keyInfo() {
  const [tonicName, flavor] = selectedKey.split(" ");
  return { tonic: NOTE_NAMES.indexOf(tonicName.replace("#", "#").replace("b", "b")), minor: flavor === "minor" };
}

function degreeHarmony(index: number, register: number, variant: Variant = "triad"): Harmony {
  const { tonic, minor } = keyInfo();
  const scale = minor ? MINOR : MAJOR;
  return {
    numeral: (minor ? MINOR_NUMERALS : MAJOR_NUMERALS)[index],
    root: (tonic + scale[index]) % 12,
    quality: (minor ? MINOR_QUALITIES : MAJOR_QUALITIES)[index],
    variant,
    // Keep i and ii° a little above the other minor-palette chords.
    register: register + (minor && index < 2 ? 1 : 0),
    duration: 4,
    voicing: 0,
  };
}

function intervals(chord: Harmony) {
  const triad = chord.quality === "major" ? [0, 4, 7] : chord.quality === "minor" ? [0, 3, 7] : [0, 3, 6];
  if (chord.variant === "sus2") return [0, 2, 7];
  if (chord.variant === "sus4") return [0, 5, 7];
  if (chord.variant === "add9") return [...triad, 14];
  if (chord.variant === "sixth") return [...triad, 9];
  if (chord.variant === "seventh") return [...triad, chord.quality === "major" && chord.numeral.startsWith("I") ? 11 : 10];
  return triad;
}

function chordNotes(chord: Harmony) {
  if (chord.notes) return chord.notes;
  return intervals(chord).map(interval => 48 + chord.register * 12 + chord.root + interval);
}

function noteName(midi: number) {
  return NOTE_NAMES[((midi % 12) + 12) % 12];
}

function chordLabel(chord: Harmony) {
  if (chord.numeral.startsWith("V7/")) return chord.numeral;
  const suffix = chord.variant === "seventh" ? "7" : chord.variant === "sixth" ? "6" : chord.variant === "sus2" ? "sus2" : chord.variant === "sus4" ? "sus4" : chord.variant === "add9" ? "add9" : "";
  return `${chord.numeral}${suffix}`;
}

function playChord(chord: Harmony, beats = chord.duration) {
  audioContext ??= new AudioContext();
  if (!masterGain) {
    masterGain = audioContext.createGain();
    masterGain.connect(audioContext.destination);
  }
  masterGain.gain.setValueAtTime(volume, audioContext.currentTime);
  if (audioContext.state === "suspended") void audioContext.resume();
  const now = audioContext.currentTime;
  const duration = Math.max(0.45, beats * (60 / tempo) * 0.92);
  for (const midi of chordNotes(chord)) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    oscillator.type = "triangle";
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    filter.type = "lowpass";
    filter.frequency.value = 1800;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.17);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(filter).connect(gain).connect(masterGain);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.04);
  }
}

function selectChord(chord: Harmony) {
  playChord(chord);
  if (mode === "add") {
    progression.push({ ...chord, notes: chordNotes(chord) });
    render();
  }
}

function chordButton(chord: Harmony, kind: "main" | "variant" | "secondary" = "main") {
  const notes = chordNotes(chord).map(noteName).join(" · ");
  return `<button class="chord ${kind}" data-chord='${JSON.stringify(chord)}' draggable="${mode === "play"}" aria-label="${chordLabel(chord)}: ${notes}">
    <strong>${chordLabel(chord)}</strong><span>${notes}</span>
  </button>`;
}

function secondaryDominant(target: number, seventh = false): Harmony {
  const { tonic, minor } = keyInfo();
  const scale = minor ? MINOR : MAJOR;
  const targetNumeral = (minor ? MINOR_NUMERALS : MAJOR_NUMERALS)[target];
  return { numeral: `V${seventh ? "7" : ""}/${targetNumeral}`, root: (tonic + scale[target] + 7) % 12, quality: "major", variant: seventh ? "seventh" : "triad", register: 1, duration: 4, voicing: 0 };
}

function renderPalette() {
  const cards = Array.from({ length: 7 }, (_, degree) => {
    const base = degreeHarmony(degree, 1);
    return `<article class="chord-card">
      <div class="variant-row">${chordButton({ ...base, variant: "seventh" }, "variant")}${chordButton({ ...base, variant: "sixth" }, "variant")}${chordButton({ ...base, variant: "sus2" }, "variant")}</div>
      ${chordButton(base)}
      <div class="variant-row">${chordButton({ ...base, variant: "sus4" }, "variant")}${chordButton({ ...base, variant: "add9" }, "variant")}</div>
      <div class="secondary-row">${chordButton(secondaryDominant(degree), "secondary")}${chordButton(secondaryDominant(degree, true), "secondary")}</div>
    </article>`;
  }).join("");
  return `<main class="palette"><section class="primary-palette"><div class="palette-label"><span>DIATONIC + SECONDARY DOMINANTS</span><small>color tones and V/x options resolve to the chord above</small></div><div class="chord-grid">${cards}</div></section></main>`;
}

function renderAbout() {
  if (!showAbout) return "";
  return `<div class="modal-backdrop" data-close-about>
    <section class="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title" onclick="event.stopPropagation()">
      <div class="about-title"><h2 id="about-title">ABOUT</h2><button data-close-about aria-label="Close about window">×</button></div>
      <p><b>Roman Playground</b> is a tiny, browser-only space for trying harmonic ideas by ear.</p>
      <h3>HOW TO USE IT</h3>
      <p>Choose a key, then use <b>PLAY</b> to audition chords or <b>ADD</b> to make a progression. Drag a palette chord into the progression to insert it, or drag progression cards to reorder them; drag a card outside the progression strip to remove it. Right-click a card (or use <b>•••</b>) to change its duration, bump its voicing, or remove it.</p>
      <h3>SOUND + LICENSE</h3>
      <p>Sound is synthesized in your browser with the Web Audio API; no samples or data leave your device. Source code is © Artemis Rosman and released under the <a href="LICENSE" target="_blank">MIT License</a>.</p>
    </section>
  </div>`;
}

function voicingLabel(chord: Harmony) {
  return chord.voicing > 0 ? `↑ ${chord.voicing}` : chord.voicing < 0 ? `↓ ${Math.abs(chord.voicing)}` : "↕ 0";
}

function renderProgression() {
  const items = progression.map((chord, index) => `<li class="progression-chord" draggable="true" data-index="${index}">
    <button class="sequence-play" data-play-index="${index}" title="Play chord"><strong>${chordLabel(chord)}</strong><span>${chordNotes(chord).map(noteName).join(" · ")}</span><em>${chord.duration} beat${chord.duration === 1 ? "" : "s"} · ${voicingLabel(chord)}</em></button>
    <aside class="card-sidebar"><button class="card-delete" data-card-delete="${index}" title="Remove chord" aria-label="Remove ${chordLabel(chord)}">×</button><div class="card-voicing" aria-label="Quick voicing controls"><button data-card-bump="up" data-card-index="${index}" title="Bump bottom note up an octave">↑</button><button data-card-bump="down" data-card-index="${index}" title="Bump top note down an octave">↓</button></div><button class="more" data-menu-index="${index}" title="Chord options" aria-label="Chord options">•••</button></aside>
  </li>`).join("");
  return `<section class="sequence-area">
    <div class="sequence-heading"><span>PROGRESSION <b>${progression.length || "—"} chord${progression.length === 1 ? "" : "s"}</b></span>
      <div><button id="clear" ${progression.length ? "" : "disabled"}>CLEAR</button><button id="play-progression" ${progression.length ? "" : "disabled"}>${isLooping ? "■ STOP" : "▶ PLAY / LOOP"}</button></div>
    </div>
    <ol id="progression" class="progression ${progression.length ? "" : "empty"}">${items || "<li>ADD MODE: click chords to build a progression.</li>"}</ol>
    ${contextMenuIndex !== null ? renderMenu(contextMenuIndex) : ""}
  </section>`;
}

function renderMenu(index: number) {
  const chord = progression[index];
  return `<div class="context-menu" id="context-menu" style="--menu-index:${index}">
    <div class="menu-title">${chordLabel(chord)} <button data-close-menu>×</button></div>
    <fieldset><legend>DURATION</legend>${[0.5, 1, 2, 3, 4].map(value => `<button class="duration ${chord.duration === value ? "active" : ""}" data-duration="${value}">${value}</button>`).join("")} <small>beats</small></fieldset>
    <fieldset><legend>VOICING</legend><button data-bump="down">↓ BUMP DOWN</button><button data-bump="up">↑ BUMP UP</button></fieldset>
    <button class="delete" data-delete>REMOVE CHORD</button>
  </div>`;
}

function render() {
  saveState();
  app.innerHTML = `<header><a class="logo" href="/">ROMAN<br><i>PLAYGROUND</i></a>
    <div class="controls"><label>KEY <select id="key-select">${keyChoices.map(key => `<option ${key === selectedKey ? "selected" : ""}>${key}</option>`).join("")}</select></label>
      <label class="volume-control">VOL <input id="volume" type="range" min="0" max="1" step="0.05" value="${volume}" aria-label="Volume" /></label>
      <label class="tempo-control">BPM <input id="tempo" type="number" min="40" max="240" step="1" value="${tempo}" aria-label="Tempo in beats per minute" /></label>
      <div class="mode-toggle" role="group" aria-label="Chord action"><button data-mode="play" class="${mode === "play" ? "active" : ""}">♬ HEAR</button><button data-mode="add" class="${mode === "add" ? "active" : ""}">+ ADD</button></div>
      <button class="about-button" data-open-about>ABOUT</button>
    </div></header>${renderProgression()}${renderPalette()}<footer><span>© Artemis Rosman · <a href="LICENSE" target="_blank">MIT License</a></span><span>Roman Playground</span></footer>${renderAbout()}`;
  bindEvents();
}

function dropIndex(event: DragEvent, item: HTMLElement) {
  const index = Number(item.dataset.index);
  const bounds = item.getBoundingClientRect();
  return event.clientX < bounds.left + bounds.width / 2 ? index : index + 1;
}

function isOverProgression(event: DragEvent) {
  const progressionStrip = document.querySelector("#progression");
  if (!progressionStrip) return false;
  const bounds = progressionStrip.getBoundingClientRect();
  return event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
}

function bindEvents() {
  document.querySelector("#key-select")?.addEventListener("change", event => { selectedKey = (event.target as HTMLSelectElement).value; render(); });
  document.querySelector("#volume")?.addEventListener("input", event => { volume = Number((event.target as HTMLInputElement).value); if (audioContext && masterGain) masterGain.gain.setValueAtTime(volume, audioContext.currentTime); });
  document.querySelector("#tempo")?.addEventListener("change", event => { const input = event.target as HTMLInputElement; tempo = Math.min(240, Math.max(40, Number(input.value) || 88)); input.value = String(tempo); });
  document.querySelector("[data-open-about]")?.addEventListener("click", () => { showAbout = true; render(); });
  document.querySelectorAll("[data-close-about]").forEach(element => element.addEventListener("click", () => { showAbout = false; render(); }));
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(button => button.addEventListener("click", () => { mode = button.dataset.mode as Mode; render(); }));
  document.querySelectorAll<HTMLButtonElement>("[data-chord]").forEach(button => {
    button.addEventListener("click", () => selectChord(JSON.parse(button.dataset.chord!)));
    button.addEventListener("dragstart", event => { if (mode !== "play" || !event.dataTransfer) return; event.dataTransfer.setData("application/x-roman-chord", button.dataset.chord!); event.dataTransfer.effectAllowed = "copy"; button.classList.add("dragging"); });
    button.addEventListener("dragend", () => button.classList.remove("dragging"));
  });
  document.querySelector("#clear")?.addEventListener("click", () => { stopLoop(); progression = []; render(); });
  document.querySelector("#play-progression")?.addEventListener("click", () => isLooping ? stopLoop() : startLoop());
  document.querySelectorAll<HTMLButtonElement>("[data-play-index]").forEach(button => button.addEventListener("click", () => playChord(progression[Number(button.dataset.playIndex)])));
  document.querySelectorAll<HTMLButtonElement>("[data-menu-index]").forEach(button => button.addEventListener("click", () => { contextMenuIndex = Number(button.dataset.menuIndex); render(); }));
  document.querySelector("#progression")?.addEventListener("dragover", event => {
    const dragEvent = event as DragEvent;
    if (!dragEvent.dataTransfer?.types.includes("application/x-roman-chord")) return;
    dragEvent.preventDefault();
    dragEvent.dataTransfer.dropEffect = "copy";
  });
  document.querySelector("#progression")?.addEventListener("drop", event => {
    const dragEvent = event as DragEvent;
    const serialized = dragEvent.dataTransfer?.getData("application/x-roman-chord");
    if (!serialized) return;
    dragEvent.preventDefault();
    try {
      const chord = JSON.parse(serialized) as Harmony;
      progression.push({ ...chord, notes: chordNotes(chord) });
      render();
    } catch { /* Ignore invalid external drag data. */ }
  });
  document.querySelectorAll<HTMLElement>(".progression-chord").forEach(item => {
    item.addEventListener("contextmenu", event => { event.preventDefault(); contextMenuIndex = Number(item.dataset.index); render(); });
    item.addEventListener("dragstart", event => { event.dataTransfer?.setData("text/plain", item.dataset.index!); if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"; item.classList.add("dragging"); });
    item.addEventListener("dragend", event => {
      document.querySelectorAll(".drag-over, .dragging").forEach(element => element.classList.remove("drag-over", "dragging"));
      if (!isOverProgression(event as DragEvent)) {
        progression.splice(Number(item.dataset.index), 1);
        render();
      }
    });
    item.addEventListener("dragover", event => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = event.dataTransfer.types.includes("application/x-roman-chord") ? "copy" : "move";
      document.querySelectorAll(".drag-over").forEach(element => element.classList.remove("drag-over"));
      item.classList.add("drag-over");
    });
    item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
    item.addEventListener("drop", event => {
      event.preventDefault();
      event.stopPropagation();
      const serialized = event.dataTransfer?.getData("application/x-roman-chord");
      const to = dropIndex(event as DragEvent, item);
      if (serialized) {
        try {
          const chord = JSON.parse(serialized) as Harmony;
          progression.splice(to, 0, { ...chord, notes: chordNotes(chord) });
        } catch { /* Ignore invalid external drag data. */ }
        render();
        return;
      }
      const from = Number(event.dataTransfer?.getData("text/plain"));
      if (Number.isInteger(from) && from >= 0 && from < progression.length) {
        const [moved] = progression.splice(from, 1);
        progression.splice(from < to ? to - 1 : to, 0, moved);
      }
      render();
    });
  });
  document.querySelector("[data-close-menu]")?.addEventListener("click", () => { contextMenuIndex = null; render(); });
  document.querySelectorAll<HTMLButtonElement>("[data-duration]").forEach(button => button.addEventListener("click", () => { if (contextMenuIndex !== null) progression[contextMenuIndex].duration = Number(button.dataset.duration); render(); }));
  document.querySelectorAll<HTMLButtonElement>("[data-bump]").forEach(button => button.addEventListener("click", () => { if (contextMenuIndex === null) return; bumpChord(progression[contextMenuIndex], button.dataset.bump === "up" ? "up" : "down"); render(); }));
  document.querySelectorAll<HTMLButtonElement>("[data-card-bump]").forEach(button => button.addEventListener("click", () => { const chord = progression[Number(button.dataset.cardIndex)]; bumpChord(chord, button.dataset.cardBump === "up" ? "up" : "down"); render(); }));
  document.querySelectorAll<HTMLButtonElement>("[data-card-delete]").forEach(button => button.addEventListener("click", () => { progression.splice(Number(button.dataset.cardDelete), 1); render(); }));
  document.querySelector("[data-delete]")?.addEventListener("click", () => { if (contextMenuIndex !== null) progression.splice(contextMenuIndex, 1); contextMenuIndex = null; render(); });
}

function bumpChord(chord: Harmony, direction: "up" | "down") {
  const notes = [...chordNotes(chord)].sort((a, b) => a - b);
  if (direction === "up") { notes[0] += 12; chord.voicing += 1; }
  else { notes[notes.length - 1] -= 12; chord.voicing -= 1; }
  chord.notes = notes.sort((a, b) => a - b);
}

function startLoop() {
  if (!progression.length) return;
  isLooping = true;
  let at = 0;
  const advance = () => {
    if (!isLooping || !progression.length) return;
    const chord = progression[at++ % progression.length];
    playChord(chord);
    loopTimer = window.setTimeout(advance, chord.duration * (60 / tempo) * 1000);
  };
  render(); advance();
}
function stopLoop() { isLooping = false; if (loopTimer) window.clearTimeout(loopTimer); loopTimer = undefined; render(); }

loadState();
render();
