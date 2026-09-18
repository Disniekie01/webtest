const video = document.getElementById("video");
const plan = document.getElementById("plan");
const vctx = video.getContext("2d");
const pctx = plan.getContext("2d");
const sourceEl = document.getElementById("source");
const playBtn = document.getElementById("btn-play");
const calBtn = document.getElementById("btn-calibrate");
const piiBtn = document.getElementById("btn-pii");
const zoneBtn = document.getElementById("btn-zone");
const camBtn = document.getElementById("btn-cam");
const banner = document.getElementById("banner");
const zoneHint = document.getElementById("zone-hint");
const calDock = document.getElementById("cal-dock");
const calStatus = document.getElementById("cal-status");
const calPreset = document.getElementById("cal-preset");
const calWidth = document.getElementById("cal-width");
const calDepth = document.getElementById("cal-depth");
const videoWrap = document.getElementById("video-wrap");
const scrub = document.getElementById("scrub");
const frameReadout = document.getElementById("frame-readout");
const speedEl = document.getElementById("speed");

const COLORS = {
  worker: "#8ec3d4",
  machine: "#e0a05a",
  vehicle: "#d4c07a",
  brass: "#c4a574",
  muted: "#9c968b",
  text: "#f2efe8",
  crit: "#d45b4a",
  zone: "rgba(212, 91, 74, 0.22)",
  zoneStroke: "#d45b4a",
  work: "rgba(122, 166, 127, 0.2)",
  workStroke: "#7aa67f",
  path: "rgba(142, 195, 212, 0.18)",
  pathStroke: "#8ec3d4",
  trip: "#c4a574",
  heat: "rgba(224, 160, 90, 0.55)",
  forecast: "rgba(224, 160, 90, 0.7)",
  grid: "rgba(242,239,232,0.08)",
  gridMajor: "rgba(242,239,232,0.16)",
  fov: "rgba(142, 195, 212, 0.14)",
  fovStroke: "rgba(142, 195, 212, 0.55)",
  clearanceAdv: "rgba(142, 195, 212, 0.08)",
  clearanceWarn: "rgba(224, 160, 90, 0.12)",
  clearanceCrit: "rgba(212, 91, 74, 0.16)",
};

let ws = null;
let playing = false;
let opened = false;
let atEnd = false;
let lastFrame = null;
let sources = [];
let calibrating = false;
let drawingZone = false;
let showHeatmap = true;
let showClearance = localStorage.getItem("yardline_clearance") !== "0";
let showMap = localStorage.getItem("yardline_map") !== "0";
let mapImage = null;
let mapMetaKey = "";
let planDragMoved = false;
let clicks = [];
let dragCorner = -1;
let zoneDraft = [];
let zones = [];
let sourceMeta = null;
let planView = null;
let planBounds = null;
let planCam = { yaw: -0.85, pitch: 0.58, dist: null, userDist: false, matchCam: true };
let planOrbit = null;
let scrubbing = false;
let briefingTimer = 0;
let pending = [];
let cameraPresets = [];
let sites = [];
let activeSiteId = localStorage.getItem("yardline_site_id") || "";
let taxonomy = { events: [], kpis: [] };
let selectedZoneId = null;
let soundEnabled = localStorage.getItem("yardline_sound") !== "0";
let lastAlarmLevel = 0;
let knownIncidentIds = new Set();
let toastTimer = 0;
let coachHidden = localStorage.getItem("yardline_coach") === "0";
let severityMin = parseInt(localStorage.getItem("yardline_severity") || "2", 10);
let highlightIds = new Set();
let highlightUntil = 0;
let hoverTrackId = null;
let activeCamSlot = parseInt(localStorage.getItem("yardline_cam_slot") || "0", 10) || 0;
let camSlots = JSON.parse(localStorage.getItem("yardline_cam_slots") || "null") || [
  { label: "Cam 1", path: "", liveUrl: "" },
  { label: "Cam 2", path: "", liveUrl: "" },
  { label: "Cam 3", path: "", liveUrl: "" },
  { label: "Cam 4", path: "", liveUrl: "" },
];
let sessionRestored = false;

const planWrap = document.getElementById("plan-wrap");
const zoneKindEl = document.getElementById("zone-kind");
const heatBtn = document.getElementById("btn-heatmap");
const mapBtn = document.getElementById("btn-map");
const clearanceBtn = document.getElementById("btn-clearance");
const mapFileEl = document.getElementById("map-file");
if (mapBtn) mapBtn.classList.toggle("active", showMap);
if (clearanceBtn) clearanceBtn.classList.toggle("active", showClearance);
const soundBtn = document.getElementById("btn-sound");
const ZONE_COLORS = {
  exclusion: { fill: COLORS.zone, stroke: COLORS.zoneStroke },
  work: { fill: COLORS.work, stroke: COLORS.workStroke },
  path: { fill: COLORS.path, stroke: COLORS.pathStroke },
  tripwire: { fill: "transparent", stroke: COLORS.trip },
};

const HEIGHT_M = { worker: 1.7, vehicle: 1.05, machine: 2.4 };
const CLASS_LABEL = { worker: "person", vehicle: "vehicle", machine: "robot" };
const CLASS_MARK = { worker: "P", vehicle: "V", machine: "M" };
const CORNER_LABELS = ["Origin", "+X", "Far", "+Y"];
const CAL_HELP = "Drag Origin, +X, Far, and +Y onto a real rectangle in the street.";

let drawToken = 0;

function fitCanvas(c) {
  const r = c.parentElement.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(r.width * dpr));
  const h = Math.max(1, Math.floor(r.height * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
}

function showBanner(text, alarm = "", { toast = false } = {}) {
  const pill = document.getElementById("alarm-pill");
  if (pill) {
    const short = !text
      ? "Clear"
      : alarm === "critical"
        ? "Critical"
        : alarm === "warning"
          ? "Warning"
          : alarm === "advisory"
            ? "Advisory"
            : alarm === "clear"
              ? "Clear"
              : text.slice(0, 28);
    pill.textContent = short;
    pill.title = text || "";
    pill.className =
      "kpi alarm" +
      (alarm === "critical"
        ? " crit"
        : alarm === "warning" || alarm === "advisory"
          ? " warn"
          : alarm === "clear"
            ? " ok"
            : "");
  }
  if (!toast || !text) return;
  banner.hidden = false;
  banner.textContent = text;
  banner.className = "banner toast" + (alarm ? ` ${alarm}` : "");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    banner.hidden = true;
  }, alarm === "critical" || alarm === "warning" ? 4200 : 2600);
}

function setPlanePill(on) {
  const el = document.getElementById("plane-pill");
  el.textContent = on ? "Plane set" : "No plane";
  el.className = "kpi" + (on ? " ok" : " muted");
}

function toast(text, alarm = "advisory") {
  showBanner(text, alarm, { toast: true });
}

function playAlertBeep(level) {
  if (!soundEnabled || level < 2 || level < severityMin) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = level >= 3 ? 880 : 620;
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(ctx.destination);
    const now = ctx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    o.start(now);
    o.stop(now + 0.25);
    window.setTimeout(() => ctx.close(), 400);
  } catch {
    /* ignore */
  }
}

function updateCoach() {
  const el = document.getElementById("coach");
  if (!el) return;
  if (coachHidden) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const hasSource = !!opened;
  const hasPlane = !!(lastFrame?.calibrated || sourceMeta?.calibrated);
  const hasZone = zones.length > 0;
  const running = playing && hasPlane;
  const map = { source: hasSource, plane: hasPlane, zone: hasZone, run: running };
  el.querySelectorAll("[data-step]").forEach((li) => {
    const key = li.getAttribute("data-step");
    li.classList.toggle("done", !!map[key]);
    li.classList.toggle("on", !map[key] && (
      (key === "source" && !hasSource) ||
      (key === "plane" && hasSource && !hasPlane) ||
      (key === "zone" && hasPlane && !hasZone) ||
      (key === "run" && hasZone && !running)
    ));
  });
  if (hasSource && hasPlane && hasZone && running) {
    window.setTimeout(() => {
      coachHidden = true;
      localStorage.setItem("yardline_coach", "0");
      el.hidden = true;
    }, 1800);
  }
}

async function loadSources(keepSelection = true) {
  const previous = sourceEl.value;
  const res = await fetch("/api/sources");
  if (!res.ok) {
    throw new Error(`Could not list sources (${res.status})`);
  }
  sources = await res.json();
  sourceEl.innerHTML = sources
    .map((s) => {
      const mark = s.calibrated ? " · plane" : s.live ? " · live" : "";
      const size = s.width && s.height ? `${s.width}×${s.height}` : "stream";
      const path = String(s.path).replace(/"/g, "&quot;");
      return `<option value="${path}">${escapeHtml(s.name)} (${size}${mark})</option>`;
    })
    .join("");
  if (keepSelection && previous && [...sourceEl.options].some((o) => o.value === previous)) {
    sourceEl.value = previous;
  } else if (sources.length && !sourceEl.value) {
    sourceEl.value = sources[0].path;
  }
  renderClipMenu();
  syncClipLabel();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const clipTrigger = document.getElementById("clip-trigger");
const clipMenu = document.getElementById("clip-menu");
const clipLabel = document.getElementById("clip-label");

function syncClipLabel() {
  if (!clipLabel) return;
  const cur = sources.find((s) => s.path === sourceEl.value);
  clipLabel.textContent = cur ? cur.name : sourceEl.value || "Select clip…";
}

function renderClipMenu() {
  if (!clipMenu) return;
  clipMenu.innerHTML = sources.length
    ? sources
        .map((s) => {
          const mark = s.calibrated ? "plane" : s.live ? "live" : "clip";
          const size = s.width && s.height ? `${s.width}×${s.height}` : "stream";
          const active = s.path === sourceEl.value ? " active" : "";
          return `<button type="button" class="menu-item${active}" role="option" data-path="${escapeHtml(s.path)}">
            <span>${escapeHtml(s.name)}</span>
            <span class="menu-meta">${size} · ${mark}</span>
          </button>`;
        })
        .join("")
    : `<p class="fine" style="margin:8px">No clips found. Use Rescan clips.</p>`;
  clipMenu.querySelectorAll("button.menu-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const path = btn.dataset.path;
      if (!path) return;
      sourceEl.value = path;
      syncClipLabel();
      closeClipMenu();
      sourceEl.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
}

function placeClipMenu() {
  if (!clipMenu?.classList.contains("is-open") || !clipTrigger) return;
  const r = clipTrigger.getBoundingClientRect();
  clipMenu.style.top = `${Math.round(r.bottom + 6)}px`;
  clipMenu.style.left = `${Math.round(r.left)}px`;
  clipMenu.style.right = "auto";
  clipMenu.style.width = `${Math.max(280, Math.round(r.width))}px`;
}

function openClipMenu() {
  if (!clipMenu || !clipTrigger) return;
  renderClipMenu();
  if (clipMenu.parentElement !== document.body) {
    document.body.appendChild(clipMenu);
  }
  clipMenu.hidden = false;
  clipMenu.classList.add("is-open");
  clipTrigger.setAttribute("aria-expanded", "true");
  placeClipMenu();
  requestAnimationFrame(placeClipMenu);
}

function closeClipMenu() {
  if (!clipMenu || !clipTrigger) return;
  clipMenu.classList.remove("is-open");
  clipMenu.hidden = true;
  clipTrigger.setAttribute("aria-expanded", "false");
}

clipTrigger?.addEventListener("click", (ev) => {
  ev.preventDefault();
  if (clipMenu?.classList.contains("is-open")) closeClipMenu();
  else openClipMenu();
});

document.addEventListener("pointerdown", (ev) => {
  if (!clipMenu?.classList.contains("is-open")) return;
  const t = ev.target;
  if (clipTrigger?.contains(t) || clipMenu.contains(t)) return;
  closeClipMenu();
});

window.addEventListener("resize", () => {
  if (clipMenu?.classList.contains("is-open")) placeClipMenu();
});


async function boot() {
  fitCanvas(video);
  fitCanvas(plan);
  window.addEventListener("resize", () => {
    fitCanvas(video);
    fitCanvas(plan);
    if (lastFrame) draw(lastFrame);
  });

  const health = await fetch("/health").then((r) => r.json());
  document.getElementById("health").textContent = health.gpu || health.device;
  setPiiButton(health.pii_redacted !== false);

  try {
    await loadSources(false);
  } catch (err) {
    showBanner(err.message || "Could not list saved clips.", "advisory");
  }
  await loadPresets();
  await loadTaxonomy();
  await loadSites();
  if (soundBtn) soundBtn.classList.toggle("active", soundEnabled);
  updateCoach();
  connect();
  loadIncidentHistory();
  try {
    const st = await fetch("/api/state").then((r) => r.json());
    if (st.kpi) updateSiteKpiPills(st.active_site, st.kpi.count);
  } catch {
    /* ignore */
  }
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    ws.onclose = null;
    ws.close();
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/stream`);
  ws.onopen = () => {
    const queued = pending.splice(0);
    queued.forEach((obj) => ws.send(JSON.stringify(obj)));
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "frame") {
      lastFrame = msg;
      atEnd = false;
      if (Array.isArray(msg.zones)) {
        zones = msg.zones;
        renderZoneList();
      }
      if (calibrating) seedQuad(msg);
      draw(msg);
      fillTables(msg);
      fillEvents(msg);
      fillIncidents(msg);
      updateTransport(msg);
      updateAlarm(msg);
      updateCoach();
      scheduleBriefing();
    } else if (msg.type === "error") {
      playing = false;
      playBtn.textContent = "Play";
      showBanner(msg.detail || "Could not open source.", "critical");
    } else if (msg.type === "ended") {
      playing = false;
      atEnd = true;
      playBtn.textContent = "Play";
      refreshBriefing();
    } else if (msg.type === "opened") {
      opened = true;
      atEnd = false;
      sourceMeta = msg.source;
      zones = msg.source.zones || [];
      renderZoneList();
      lastFrame = null;
      planBounds = null;
      planCam.dist = null;
      planCam.userDist = false;
      planCam.matchCam = true;
      setMatchCamButton(true);
      const live = !!msg.source.live;
      document.getElementById("video-meta").textContent = live
        ? `${Math.round(msg.source.fps) || "—"} fps · live camera/stream · inference on each frame` +
          (msg.source.calibrated ? " · saved plane loaded" : "")
        : `${Math.round(msg.source.fps)} fps · ${msg.source.frames} frames · live inference` +
          (msg.source.calibrated ? " · saved plane loaded" : "");
      document.getElementById("plan-meta").textContent = msg.source.calibrated
        ? "3D matches the camera. Distant people shrink. Drag to orbit."
        : "3D street after calibration. Empty until a homography exists.";
      scrub.disabled = live;
      if (live) {
        scrub.max = "0";
        scrub.value = "0";
        frameReadout.textContent = "LIVE";
      } else {
        scrub.max = String(Math.max(0, (msg.source.frames || 1) - 1));
        scrub.value = "0";
        frameReadout.textContent = `Frame 0 / ${msg.source.frames || "—"}`;
      }
      if (msg.source.calibrated) {
        setPlanePill(true);
        toast("Plane loaded · metric clearance live", "clear");
      } else {
        setPlanePill(false);
        toast(live ? "Live open · calibrate to unlock metres" : "Clip open · calibrate to unlock metres", "advisory");
      }
      if (live) {
        send({ action: "play" });
        playing = true;
        playBtn.textContent = "Pause";
      }
      updateCoach();
      refreshBriefing();
      loadIncidentHistory();
      saveSession();
      suggestStreamPreset(msg.source.path || msg.source.id);
    }
  };
  ws.onclose = () => {
    playing = false;
    opened = false;
    playBtn.textContent = "Play";
    window.setTimeout(() => {
      if (!ws || ws.readyState === WebSocket.CLOSED) connect();
    }, 400);
  };
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  else pending.push(obj);
}

playBtn.addEventListener("click", () => {
  if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) connect();
  if (!playing) {
    if (atEnd) send({ action: "restart" });
    else if (!opened) send({ action: "open", path: sourceEl.value });
    send({ action: "play" });
    playing = true;
    playBtn.textContent = "Pause";
  } else {
    send({ action: "pause" });
    playing = false;
    playBtn.textContent = "Play";
    refreshBriefing();
  }
});

document.getElementById("btn-step").addEventListener("click", () => {
  if (!opened) send({ action: "open", path: sourceEl.value });
  send({ action: "step" });
  playing = false;
  playBtn.textContent = "Play";
});

document.getElementById("btn-restart").addEventListener("click", () => {
  send({ action: "restart" });
  playing = false;
  playBtn.textContent = "Play";
});

document.getElementById("btn-rescan").addEventListener("click", () => loadSources(true));

const toolsPop = document.getElementById("tools-pop");
const toolsMenu = toolsPop?.querySelector(".tools-menu");
const toolsSummary = toolsPop?.querySelector("summary");

function placeToolsMenu() {
  if (!toolsPop?.open || !toolsMenu || !toolsSummary) return;
  const r = toolsSummary.getBoundingClientRect();
  toolsMenu.style.top = `${Math.round(r.bottom + 6)}px`;
  toolsMenu.style.right = `${Math.round(window.innerWidth - r.right)}px`;
  toolsMenu.style.left = "auto";
}

toolsPop?.addEventListener("toggle", () => {
  if (!toolsMenu) return;
  if (toolsPop.open) {
    if (toolsMenu.parentElement !== document.body) {
      document.body.appendChild(toolsMenu);
    }
    toolsMenu.classList.add("is-open");
    placeToolsMenu();
    requestAnimationFrame(placeToolsMenu);
  } else {
    toolsMenu.classList.remove("is-open");
  }
});
window.addEventListener("resize", placeToolsMenu);
window.addEventListener(
  "scroll",
  () => {
    if (toolsPop?.open) placeToolsMenu();
  },
  true
);
document.addEventListener("pointerdown", (ev) => {
  if (!toolsPop?.open) return;
  const t = ev.target;
  if (toolsPop.contains(t) || toolsMenu?.contains(t)) return;
  toolsPop.removeAttribute("open");
  toolsMenu?.classList.remove("is-open");
});

document.getElementById("btn-live").addEventListener("click", () => {
  const url = document.getElementById("live-url").value.trim();
  if (!url) {
    showBanner("Paste a YouTube, RTSP, or HTTP stream URL.", "advisory");
    return;
  }
  opened = false;
  atEnd = false;
  send({ action: "open", path: url });
  playing = false;
  playBtn.textContent = "Play";
  showBanner("Opening live source…");
});

sourceEl.addEventListener("change", () => {
  syncClipLabel();
  closeClipMenu();
  opened = false;
  atEnd = false;
  send({ action: "open", path: sourceEl.value });
  playing = false;
  playBtn.textContent = "Play";
});

speedEl.addEventListener("change", () => {
  send({ action: "speed", rate: parseFloat(speedEl.value) });
});

scrub.addEventListener("mousedown", () => {
  scrubbing = true;
});
scrub.addEventListener("mouseup", () => {
  scrubbing = false;
  send({ action: "seek", frame: parseInt(scrub.value, 10) });
  playing = false;
  playBtn.textContent = "Play";
});
scrub.addEventListener("change", () => {
  if (!scrubbing) return;
  send({ action: "seek", frame: parseInt(scrub.value, 10) });
  playing = false;
  playBtn.textContent = "Play";
});

function setPiiButton(on) {
  if (!piiBtn) return;
  piiBtn.classList.toggle("active", !!on);
  piiBtn.textContent = on ? "Redact PII" : "PII off";
}

piiBtn.addEventListener("click", async () => {
  const on = !piiBtn.classList.contains("active");
  const res = await fetch("/api/privacy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: on }),
  });
  const data = await res.json();
  setPiiButton(!!data.pii_redacted);
});

calBtn.addEventListener("click", () => {
  if (calibrating) stopCalibration();
  else startCalibration();
});

function startCalibration() {
  drawingZone = false;
  zoneBtn.classList.remove("active");
  zoneHint.hidden = true;
  calibrating = true;
  dragCorner = -1;
  calBtn.classList.add("active");
  videoWrap.classList.add("calibrating");
  calDock.hidden = false;
  calStatus.textContent = CAL_HELP;
  if (playing) {
    send({ action: "pause" });
    playing = false;
    playBtn.textContent = "Play";
  }
  if (!lastFrame) {
    clicks = [];
    if (!opened) send({ action: "open", path: sourceEl.value });
    send({ action: "step" });
  } else {
    clicks = [];
    seedQuad(lastFrame);
    draw(lastFrame);
  }
  showBanner("Drag the quad onto a real rectangle, set its size in metres, then apply.");
}

function stopCalibration() {
  calibrating = false;
  dragCorner = -1;
  calBtn.classList.remove("active");
  videoWrap.classList.remove("calibrating");
  calDock.hidden = true;
  clicks = [];
  if (lastFrame) draw(lastFrame);
}

function seedQuad(frame) {
  if (clicks.length === 4) return;
  if (frame.plane?.image_points?.length === 4) {
    clicks = frame.plane.image_points.map((p) => [p[0], p[1]]);
    return;
  }
  const w = frame.width;
  const h = frame.height;
  clicks = [
    [w * 0.28, h * 0.82],
    [w * 0.72, h * 0.82],
    [w * 0.62, h * 0.52],
    [w * 0.38, h * 0.52],
  ];
}

function setMatchCamButton(on) {
  if (!camBtn) return;
  planCam.matchCam = !!on;
  camBtn.classList.toggle("active", !!on);
}

camBtn?.addEventListener("click", () => {
  setMatchCamButton(!planCam.matchCam);
  if (planCam.matchCam) {
    planCam.userDist = false;
    document.getElementById("plan-meta").textContent =
      "3D matches the camera. Distant people shrink. Drag to orbit.";
  } else {
    document.getElementById("plan-meta").textContent = "Orbit view. Match cam returns to the live camera.";
  }
  if (lastFrame) drawPlan(lastFrame);
});

zoneBtn.addEventListener("click", () => {
  drawingZone = !drawingZone;
  zoneBtn.classList.toggle("active", drawingZone);
  zoneHint.hidden = !drawingZone;
  if (drawingZone) {
    stopCalibration();
    zoneDraft = [];
    const kind = zoneKindEl?.value || "exclusion";
    zoneHint.textContent =
      kind === "tripwire"
        ? "Click two endpoints on the plan for the tripwire."
        : "Click vertices on the plan. Enter or double-click to close.";
  }
});

heatBtn?.addEventListener("click", () => {
  showHeatmap = !showHeatmap;
  heatBtn.classList.toggle("active", showHeatmap);
  if (lastFrame) drawPlan(lastFrame);
});

clearanceBtn?.addEventListener("click", () => {
  showClearance = !showClearance;
  localStorage.setItem("yardline_clearance", showClearance ? "1" : "0");
  clearanceBtn.classList.toggle("active", showClearance);
  if (lastFrame) drawPlan(lastFrame);
});

mapBtn?.addEventListener("click", () => {
  if (!mapImage) {
    mapFileEl?.click();
    return;
  }
  showMap = !showMap;
  localStorage.setItem("yardline_map", showMap ? "1" : "0");
  mapBtn.classList.toggle("active", showMap);
  if (lastFrame) drawPlan(lastFrame);
});

mapBtn?.addEventListener("contextmenu", (ev) => {
  ev.preventDefault();
  mapFileEl?.click();
});

mapFileEl?.addEventListener("change", async () => {
  const file = mapFileEl.files?.[0];
  if (!file) return;
  const body = new FormData();
  body.append("file", file);
  try {
    const res = await fetch("/api/map", { method: "POST", body });
    const data = await res.json();
    if (!res.ok) {
      toast(data.detail || "Map upload failed", "warning");
      return;
    }
    showMap = true;
    localStorage.setItem("yardline_map", "1");
    mapBtn?.classList.add("active");
    await ensureMapImage(data.map);
    toast("Map underlay set", "advisory");
    if (lastFrame) drawPlan(lastFrame);
  } catch {
    toast("Map upload failed", "warning");
  } finally {
    mapFileEl.value = "";
  }
});

document.getElementById("btn-map-clear")?.addEventListener("click", async () => {
  try {
    await fetch("/api/map", { method: "DELETE" });
  } catch {
    /* ignore */
  }
  mapImage = null;
  mapMetaKey = "";
  mapBtn?.classList.remove("active");
  if (lastFrame) {
    lastFrame.map = null;
    drawPlan(lastFrame);
  }
});

document.getElementById("btn-zone-undo").addEventListener("click", async () => {
  if (zoneDraft.length) {
    zoneDraft.pop();
    if (lastFrame) draw(lastFrame);
    return;
  }
  if (!zones.length) return;
  const next = zones.slice(0, -1);
  await fetch("/api/zones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ zones: next }),
  });
  zones = next;
  renderZoneList();
  if (lastFrame) {
    lastFrame.zones = zones;
    draw(lastFrame);
  }
});

document.getElementById("btn-zone-clear").addEventListener("click", async () => {
  await fetch("/api/zones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ zones: [] }),
  });
  zones = [];
  zoneDraft = [];
  renderZoneList();
  if (lastFrame) {
    lastFrame.zones = [];
    draw(lastFrame);
  }
});

document.getElementById("cal-cancel").addEventListener("click", () => stopCalibration());

document.getElementById("cal-clear").addEventListener("click", async () => {
  await fetch("/api/calibrate/clear", { method: "POST" });
  calStatus.textContent = "Saved plane cleared for this source.";
  showBanner("Calibrate a ground plane to enable metric TTC. Until then, tracking runs in pixels only.");
});

calPreset.addEventListener("change", () => {
  const [w, d] = calPreset.value.split(",").map(Number);
  calWidth.value = String(w);
  calDepth.value = String(d);
});

calDock.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (clicks.length < 4) {
    calStatus.textContent = "Need four corners on the camera.";
    return;
  }
  const widthM = parseFloat(calWidth.value);
  const depthM = parseFloat(calDepth.value);
  if (!(widthM > 0) || !(depthM > 0)) {
    calStatus.textContent = "Width and depth must be positive metres.";
    return;
  }
  const world_points = [
    [0, 0],
    [widthM, 0],
    [widthM, depthM],
    [0, depthM],
  ];
  const res = await fetch("/api/calibrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_points: clicks, world_points }),
  });
  const data = await res.json();
  if (!res.ok) {
    calStatus.textContent = data.detail || "Calibration failed";
    return;
  }
  stopCalibration();
  setPlanePill(true);
  toast(`Ground plane saved · ${widthM}×${depthM} m · ${data.rms_px} px RMS`, "clear");
  planBounds = null;
  document.getElementById("plan-meta").textContent =
    "Map locked to the calibrated pad. Tracks move; the view does not chase them.";
  updateCoach();
  if (lastFrame) {
    lastFrame.calibrated = true;
    lastFrame.plane = data.plane;
    lastFrame.risk = lastFrame.risk || {};
    lastFrame.risk.method = "constant-velocity discs";
    draw(lastFrame);
  }
});

function eventToFrame(ev) {
  if (!lastFrame) return null;
  const rect = video.getBoundingClientRect();
  const cx = (ev.clientX - rect.left) * (video.width / rect.width);
  const cy = (ev.clientY - rect.top) * (video.height / rect.height);
  const { dx, dy, dw, dh } = contain(lastFrame.width, lastFrame.height, video.width, video.height);
  const u = ((cx - dx) / dw) * lastFrame.width;
  const v = ((cy - dy) / dh) * lastFrame.height;
  if (u < 0 || v < 0 || u > lastFrame.width || v > lastFrame.height) return null;
  return [u, v, cx, cy];
}

function hitCorner(cx, cy) {
  if (!lastFrame || clicks.length !== 4) return -1;
  const { dx, dy, dw, dh } = contain(lastFrame.width, lastFrame.height, video.width, video.height);
  const radius = 16 * (video.width / Math.max(1, video.getBoundingClientRect().width));
  let best = -1;
  let bestD = radius;
  clicks.forEach((pt, i) => {
    const x = dx + (pt[0] / lastFrame.width) * dw;
    const y = dy + (pt[1] / lastFrame.height) * dh;
    const d = Math.hypot(cx - x, cy - y);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

videoWrap.addEventListener("pointerdown", (ev) => {
  if (!calibrating || !lastFrame) return;
  if (ev.target.closest("#cal-dock")) return;
  const mapped = eventToFrame(ev);
  if (!mapped) return;
  const rect = video.getBoundingClientRect();
  const cx = (ev.clientX - rect.left) * (video.width / rect.width);
  const cy = (ev.clientY - rect.top) * (video.height / rect.height);
  const hit = hitCorner(cx, cy);
  if (hit < 0) return;
  dragCorner = hit;
  videoWrap.setPointerCapture(ev.pointerId);
  ev.preventDefault();
});

videoWrap.addEventListener("pointermove", (ev) => {
  if (dragCorner < 0 || !lastFrame) return;
  const mapped = eventToFrame(ev);
  if (!mapped) return;
  clicks[dragCorner] = [mapped[0], mapped[1]];
  draw(lastFrame);
});

videoWrap.addEventListener("pointerup", () => {
  dragCorner = -1;
});

videoWrap.addEventListener("pointercancel", () => {
  dragCorner = -1;
});

plan.parentElement.addEventListener("click", (ev) => {
  if (!drawingZone || !planView || !lastFrame?.calibrated) return;
  const pt = worldFromPlanEvent(ev);
  if (!pt) return;
  zoneDraft.push(pt);
  const kind = zoneKindEl?.value || "exclusion";
  if (kind === "tripwire" && zoneDraft.length >= 2) {
    closeZone();
    return;
  }
  draw(lastFrame);
});

planWrap.addEventListener("pointerdown", (ev) => {
  if (drawingZone || !lastFrame?.calibrated) return;
  planDragMoved = false;
  planOrbit = { x: ev.clientX, y: ev.clientY, yaw: planCam.yaw, pitch: planCam.pitch };
  planWrap.setPointerCapture(ev.pointerId);
  ev.preventDefault();
});

planWrap.addEventListener("pointermove", (ev) => {
  if (!planOrbit) {
    if (!drawingZone && lastFrame?.calibrated) {
      const pt = worldFromPlanEvent(ev);
      const hit = nearestTrackAt(pt, lastFrame, 1.8);
      if (hit !== hoverTrackId) {
        hoverTrackId = hit;
        draw(lastFrame);
      }
    }
    return;
  }
  const dx = ev.clientX - planOrbit.x;
  const dy = ev.clientY - planOrbit.y;
  if (Math.hypot(dx, dy) > 6) planDragMoved = true;
  if (planCam.matchCam && Math.hypot(dx, dy) > 8) {
    setMatchCamButton(false);
    document.getElementById("plan-meta").textContent = "Orbit view. Match cam returns to the live camera.";
  }
  if (planCam.matchCam) return;
  planCam.yaw = planOrbit.yaw - dx * 0.008;
  planCam.pitch = Math.min(1.25, Math.max(0.18, planOrbit.pitch + dy * 0.006));
  if (lastFrame) drawPlan(lastFrame);
});

planWrap.addEventListener("pointerup", (ev) => {
  const wasOrbit = planOrbit;
  planOrbit = null;
  if (!wasOrbit || drawingZone || !lastFrame?.calibrated) return;
  if (planDragMoved) return;
  const pt = worldFromPlanEvent(ev);
  const hit = nearestTrackAt(pt, lastFrame, 2.4);
  if (hit != null) {
    flashTracks(hit);
    hoverTrackId = hit;
    draw(lastFrame);
  }
});

planWrap.addEventListener("pointercancel", () => {
  planOrbit = null;
});

planWrap.addEventListener("pointerleave", () => {
  if (planOrbit) return;
  if (hoverTrackId != null && lastFrame) {
    hoverTrackId = null;
    draw(lastFrame);
  }
});

planWrap.addEventListener(
  "wheel",
  (ev) => {
    if (!lastFrame?.calibrated) return;
    ev.preventDefault();
    if (planCam.matchCam) {
      setMatchCamButton(false);
      document.getElementById("plan-meta").textContent = "Orbit view. Match cam returns to the live camera.";
    }
    const d = planCam.dist || 20;
    planCam.userDist = true;
    planCam.dist = Math.min(220, Math.max(3, d * (ev.deltaY > 0 ? 1.09 : 0.91)));
    if (lastFrame) drawPlan(lastFrame);
  },
  { passive: false }
);

plan.parentElement.addEventListener("dblclick", (ev) => {
  ev.preventDefault();
  closeZone();
});

window.addEventListener("keydown", (ev) => {
  const typing = ev.target && ["INPUT", "SELECT", "TEXTAREA"].includes(ev.target.tagName);
  if (!typing && ev.code === "Space") {
    ev.preventDefault();
    playBtn.click();
    return;
  }
  if (calibrating) {
    if (ev.key === "Escape") {
      stopCalibration();
      return;
    }
  }
  if (!drawingZone) return;
  if (ev.key === "Enter") {
    ev.preventDefault();
    closeZone();
  } else if (ev.key === "Escape") {
    zoneDraft = [];
    drawingZone = false;
    zoneBtn.classList.remove("active");
    zoneHint.hidden = true;
    if (lastFrame) draw(lastFrame);
  } else if (ev.key === "Backspace") {
    zoneDraft.pop();
    if (lastFrame) draw(lastFrame);
  } else if (ev.key === "Delete") {
    fetch("/api/zones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zones: [] }),
    }).then(() => {
      zones = [];
      zoneDraft = [];
      if (lastFrame) {
        lastFrame.zones = [];
        draw(lastFrame);
      }
    });
  }
});

async function closeZone() {
  const kind = zoneKindEl?.value || "exclusion";
  if (kind === "tripwire") {
    if (zoneDraft.length < 2) return;
  } else if (zoneDraft.length < 3) {
    return;
  }
  const n = zones.filter((z) => (z.kind || "exclusion") === kind).length + 1;
  const zone = {
    id: `z${Date.now()}`,
    name: `${kind[0].toUpperCase()}${kind.slice(1)} ${n}`,
    kind,
    level: kind === "exclusion" ? 2 : kind === "tripwire" ? 1 : 0,
    dwell_s: 0,
  };
  if (kind === "tripwire") {
    zone.a = [round2(zoneDraft[0][0]), round2(zoneDraft[0][1])];
    zone.b = [round2(zoneDraft[1][0]), round2(zoneDraft[1][1])];
    zone.polygon = [zone.a, zone.b];
  } else {
    zone.polygon = zoneDraft.map((p) => [round2(p[0]), round2(p[1])]);
  }
  zoneDraft = [];
  drawingZone = false;
  zoneBtn.classList.remove("active");
  zoneHint.hidden = true;
  selectedZoneId = zone.id;
  await persistZones([...zones, zone]);
  toast(`${zone.name} saved`, "clear");
}

function renderZoneList() {
  const el = document.getElementById("zone-list");
  if (!el) return;
  if (!zones.length) {
    el.innerHTML = `<li class="fine" style="cursor:default;border-style:dashed">No zones yet — Draw on the plan</li>`;
    selectedZoneId = null;
    fillZoneInspector(null);
    return;
  }
  if (selectedZoneId && !zones.some((z) => z.id === selectedZoneId)) selectedZoneId = null;
  const counts = (lastFrame?.risk?.trip_counts) || {};
  const occ = (lastFrame?.risk?.occupancy) || {};
  el.innerHTML = zones
    .map((z) => {
      const kind = z.kind || "exclusion";
      let extra = "";
      if (kind === "tripwire") extra = ` · ×${counts[z.id] || 0}`;
      else if (occ[z.id]) extra = ` · ${occ[z.id]} in`;
      const sel = z.id === selectedZoneId ? " selected" : "";
      return `<li class="${sel}" data-id="${z.id}"><span class="zk ${kind}">${kind}</span>
        <span>${z.name || z.id}${extra}</span>
        <button type="button" class="ghost zone-del" data-id="${z.id}">×</button></li>`;
    })
    .join("");
  el.querySelectorAll("li[data-id]").forEach((li) => {
    li.addEventListener("click", (ev) => {
      if (ev.target.closest(".zone-del")) return;
      selectedZoneId = li.getAttribute("data-id");
      renderZoneList();
      if (lastFrame) drawPlan(lastFrame);
    });
  });
  el.querySelectorAll(".zone-del").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const id = btn.getAttribute("data-id");
      await persistZones(zones.filter((z) => z.id !== id));
    });
  });
  fillZoneInspector(zones.find((z) => z.id === selectedZoneId) || null);
}

function fillZoneInspector(zone) {
  const form = document.getElementById("zone-inspector");
  if (!form) return;
  if (!zone) {
    form.hidden = true;
    return;
  }
  form.hidden = false;
  document.getElementById("zi-name").value = zone.name || "";
  document.getElementById("zi-kind").value = zone.kind || "exclusion";
  document.getElementById("zi-level").value = String(zone.level ?? 2);
  document.getElementById("zi-dwell").value = String(zone.dwell_s ?? 0);
}

async function persistZones(next) {
  const res = await fetch("/api/zones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ zones: next }),
  });
  const data = await res.json();
  zones = data.zones || next;
  renderZoneList();
  updateCoach();
  if (lastFrame) {
    lastFrame.zones = zones;
    draw(lastFrame);
  }
}

function incidentUrl(path) {
  if (!path) return null;
  const m = String(path).match(/data\/incidents\/(.+)$/);
  return m ? `/incidents/${m[1]}` : null;
}

function renderIncidentGrid(rows) {
  const grid = document.getElementById("incident-grid");
  const badge = document.getElementById("inc-badge");
  const kpi = document.getElementById("m-inc");
  if (kpi) kpi.textContent = `Inc ${rows.length}`;
  if (badge) {
    badge.hidden = rows.length === 0;
    badge.textContent = String(rows.length);
  }
  if (!grid) return;
  if (!rows.length) {
    grid.innerHTML = `<p class="fine empty">No incidents yet. Escalate a clearance alarm to capture one.</p>`;
    return;
  }
  grid.innerHTML = rows
    .slice()
    .reverse()
    .map((inc) => {
      const still = incidentUrl(inc.still);
      const clip = incidentUrl(inc.clip);
      const thumb = still
        ? `<img src="${still}" alt="" loading="lazy" />`
        : `<div style="aspect-ratio:16/10;background:#111;display:grid;place-items:center;color:#666;font-size:11px">No still</div>`;
      return `<div class="incident-card" data-still="${still || ""}" data-clip="${clip || ""}">
        <button type="button" class="incident-open" style="border:0;padding:0;background:transparent;cursor:pointer;text-align:left;color:inherit">
          ${thumb}
          <div class="meta">
            <strong>${inc.event_label || inc.event_code || inc.alarm || "alarm"}</strong>
            <span>${inc.event_code || ""} · f${inc.frame_index ?? inc.frame ?? "—"} · ${String(inc.id || "").slice(-10)}</span>
          </div>
        </button>
        <div class="review">
          <button type="button" data-kind="near_miss" data-id="${inc.id || ""}" data-still="${still || ""}" data-alarm="${inc.alarm || ""}" data-frame="${inc.frame_index ?? inc.frame ?? ""}">Near-miss</button>
          <button type="button" data-kind="false_alarm" data-id="${inc.id || ""}" data-still="${still || ""}" data-alarm="${inc.alarm || ""}" data-frame="${inc.frame_index ?? inc.frame ?? ""}">False</button>
          <button type="button" data-kind="controlled" data-id="${inc.id || ""}" data-still="${still || ""}" data-alarm="${inc.alarm || ""}" data-frame="${inc.frame_index ?? inc.frame ?? ""}">OK</button>
        </div>
      </div>`;
    })
    .join("");
  grid.querySelectorAll(".incident-open").forEach((btn) => {
    const card = btn.closest(".incident-card");
    btn.addEventListener("click", () => openIncidentPreview(card.dataset.still, card.dataset.clip));
  });
  grid.querySelectorAll(".review button").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: btn.dataset.kind,
          incident_id: btn.dataset.id || null,
          still: btn.dataset.still || null,
          alarm: btn.dataset.alarm || null,
          frame_index: btn.dataset.frame ? parseInt(btn.dataset.frame, 10) : null,
          note: "incident drawer review",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.detail || "Label failed", "critical");
        return;
      }
      toast(`Labeled ${btn.dataset.kind}`, "clear");
    });
  });
}

function fillIncidents(frame) {
  const rows = frame.incidents || [];
  for (const inc of rows) {
    if (inc.id && !knownIncidentIds.has(inc.id)) {
      knownIncidentIds.add(inc.id);
    }
  }
  if (rows.length) renderIncidentGrid(rows.map((r) => ({
    ...r,
    frame_index: r.frame,
  })));
}

async function loadIncidentHistory() {
  try {
    const data = await fetch("/api/incidents?limit=40").then((r) => r.json());
    const rows = data.incidents || [];
    rows.forEach((r) => knownIncidentIds.add(r.id));
    renderIncidentGrid(rows);
  } catch {
    /* ignore */
  }
}

function openIncidentDrawer(open = true) {
  document.getElementById("incident-drawer").hidden = !open;
  document.getElementById("drawer-backdrop").hidden = !open;
  if (open) loadIncidentHistory();
}

function openIncidentPreview(still, clip) {
  const box = document.getElementById("incident-preview");
  const img = document.getElementById("preview-still");
  const vid = document.getElementById("preview-clip");
  img.hidden = true;
  vid.hidden = true;
  vid.removeAttribute("src");
  if (clip) {
    vid.src = clip;
    vid.hidden = false;
  } else if (still) {
    img.src = still;
    img.hidden = false;
  } else {
    return;
  }
  box.hidden = false;
}

function closeIncidentPreview() {
  const box = document.getElementById("incident-preview");
  const vid = document.getElementById("preview-clip");
  box.hidden = true;
  vid.pause?.();
  vid.removeAttribute("src");
}

async function loadPresets() {
  try {
    const data = await fetch("/api/presets").then((r) => r.json());
    cameraPresets = data.presets || [];
    const sel = document.getElementById("preset-select");
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">—</option>` + cameraPresets.map((p) =>
      `<option value="${p.id}">${p.name}</option>`
    ).join("");
    if (cur) sel.value = cur;
  } catch {
    /* ignore */
  }
}

async function loadSites() {
  try {
    const data = await fetch("/api/sites").then((r) => r.json());
    sites = data.sites || [];
    activeSiteId = data.active_site_id || activeSiteId || "";
    const sel = document.getElementById("site-select");
    if (!sel) return;
    sel.innerHTML =
      `<option value="">—</option>` +
      sites.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
    if (activeSiteId) sel.value = activeSiteId;
    updateSiteKpiPills(data.active_site || sites.find((s) => s.id === activeSiteId));
    const origin = (data.active_site || {}).origin_geo;
    if (origin) {
      const lat = document.getElementById("geo-lat");
      const lon = document.getElementById("geo-lon");
      const bearing = document.getElementById("geo-bearing");
      if (lat && !lat.value) lat.value = origin.lat;
      if (lon && !lon.value) lon.value = origin.lon;
      if (bearing && origin.bearing_deg != null) bearing.value = origin.bearing_deg;
    }
  } catch {
    /* ignore */
  }
}

async function loadTaxonomy() {
  try {
    taxonomy = await fetch("/api/taxonomy").then((r) => r.json());
  } catch {
    taxonomy = { events: [], kpis: [] };
  }
}

function updateSiteKpiPills(site, kpiCount = null) {
  const siteEl = document.getElementById("m-site");
  const kpiEl = document.getElementById("m-kpi");
  if (siteEl) siteEl.textContent = site?.name ? `Site ${String(site.name).slice(0, 16)}` : "Site —";
  if (!kpiEl) return;
  const kpiId = site?.kpi || "near_miss";
  const meta = (taxonomy.kpis || []).find((k) => k.id === kpiId);
  const label = meta?.label || kpiId;
  if (kpiCount != null) {
    kpiEl.textContent = `KPI ${kpiCount}`;
    kpiEl.title = label;
  } else {
    kpiEl.textContent = `KPI ${label.split(" ")[0]}`;
    kpiEl.title = label;
  }
}

function syncSiteFromFrame(frame) {
  if (!frame?.site) return;
  const siteEl = document.getElementById("m-site");
  if (siteEl && frame.site.site_name) {
    siteEl.textContent = `Site ${String(frame.site.site_name).slice(0, 16)}`;
  }
  if (frame.geo_anchor) {
    const lat = document.getElementById("geo-lat");
    const lon = document.getElementById("geo-lon");
    const bearing = document.getElementById("geo-bearing");
    if (lat && document.activeElement !== lat) lat.value = frame.geo_anchor.lat;
    if (lon && document.activeElement !== lon) lon.value = frame.geo_anchor.lon;
    if (bearing && frame.geo_anchor.bearing_deg != null && document.activeElement !== bearing) {
      bearing.value = frame.geo_anchor.bearing_deg;
    }
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function worldFromPlanEvent(ev) {
  if (!planView || !planView.unproject) return null;
  const rect = plan.getBoundingClientRect();
  const cx = (ev.clientX - rect.left) * (plan.width / rect.width);
  const cy = (ev.clientY - rect.top) * (plan.height / rect.height);
  return planView.unproject(cx, cy);
}

function updateTransport(frame) {
  if (sourceMeta && sourceMeta.live) {
    frameReadout.textContent = `LIVE · frame ${frame.frame_index ?? 0}`;
    return;
  }
  const total = frame.source_frames || (sourceMeta && sourceMeta.frames) || 0;
  if (!scrubbing) {
    scrub.max = String(Math.max(0, total - 1));
    scrub.value = String(frame.frame_index ?? 0);
  }
  frameReadout.textContent = `Frame ${frame.frame_index ?? 0} / ${total || "—"}`;
}

function updateAlarm(frame) {
  if (calibrating) return;
  const alarm = frame.risk.alarm;
  const level = Number(frame.risk.alarm_level || 0);
  if (level > lastAlarmLevel) {
    playAlertBeep(level);
    if (level >= 2 && level >= severityMin) {
      toast(
        level >= 3
          ? `Critical · clr ${fmtM(frame.risk.min_clearance_m)}`
          : `Warning · clr ${fmtM(frame.risk.min_clearance_m)}`,
        level >= 3 ? "critical" : "warning"
      );
      if (level >= 3) openIncidentDrawer(true);
    }
  }
  lastAlarmLevel = level;

  if (!frame.calibrated) {
    showBanner("No plane", "advisory");
    return;
  }
  const alarmLevel = { clear: 0, advisory: 1, warning: 2, critical: 3, uncalibrated: 0 }[alarm] ?? 0;
  if (alarmLevel > 0 && alarmLevel < severityMin) {
    showBanner("Clear", "clear");
    return;
  }
  if (alarm === "critical") {
    const ttc = frame.risk.min_ttc_s;
    const clr = frame.risk.min_clearance_m;
    const sep =
      clr != null
        ? `clearance ${clr.toFixed(1)} m`
        : `separation ${fmtM(frame.risk.min_distance_m)}`;
    showBanner(
      `Critical · ${sep}${ttc == null ? "" : ` · TTC ${ttc.toFixed(2)} s`}`,
      "critical"
    );
  } else if (alarm === "warning") {
    const clr = frame.risk.min_clearance_m;
    showBanner(
      clr != null
        ? `Warning · clearance ${clr.toFixed(1)} m`
        : `Warning · person–hazard pair`,
      "warning"
    );
  } else if (alarm === "advisory") {
    showBanner("Advisory", "advisory");
  } else if ((frame.risk.zone_hits || []).length) {
    showBanner("In zone", "warning");
  } else {
    showBanner("Clear", "clear");
  }
}

function fmtM(v) {
  return v == null ? "n/a" : `${v.toFixed(1)} m`;
}

function draw(frame) {
  drawVideo(frame);
  drawPlan(frame);
  const alarm = frame.risk.alarm;
  const ttc = frame.risk.min_ttc_s;
  const ttcEl = document.getElementById("m-ttc");
  if (!frame.calibrated) {
    ttcEl.textContent = "TTC —";
    ttcEl.className = "kpi muted";
  } else {
    ttcEl.textContent = ttc == null ? "TTC none" : `TTC ${ttc.toFixed(1)}s`;
    ttcEl.className =
      "kpi" + (ttc != null && ttc < 1.2 ? " crit" : ttc != null && ttc < 2.5 ? " warn" : " ok");
  }
  document.getElementById("m-dist").textContent =
    frame.risk.min_clearance_m != null
      ? `Clr ${frame.risk.min_clearance_m.toFixed(1)}m`
      : frame.risk.min_distance_m == null
        ? "Sep —"
        : `Sep ${frame.risk.min_distance_m.toFixed(1)}m`;
  document.getElementById("m-workers").textContent = `P ${frame.n_workers ?? 0}`;
  const vehicles = (frame.n_vehicles ?? 0) + (frame.n_machines ?? 0);
  document.getElementById("m-machines").textContent = `V ${vehicles}`;
  document.getElementById("m-lat").textContent = `${frame.latency_ms.toFixed(0)} ms`;
  const trips = Object.values(frame.risk?.trip_counts || {}).reduce((a, b) => a + Number(b || 0), 0);
  const tripsEl = document.getElementById("m-trips");
  if (tripsEl) tripsEl.textContent = `Cross ${trips}`;
  setPlanePill(!!frame.calibrated);
  syncSiteFromFrame(frame);
}

function drawVideo(frame) {
  const token = ++drawToken;
  const bin = Uint8Array.from(atob(frame.jpeg), (c) => c.charCodeAt(0));
  createImageBitmap(new Blob([bin], { type: "image/jpeg" })).then((bmp) => {
    if (token !== drawToken) {
      bmp.close();
      return;
    }
    fitCanvas(video);
    const { dx, dy, dw, dh } = contain(bmp.width, bmp.height, video.width, video.height);
    vctx.fillStyle = "#0d0c0b";
    vctx.fillRect(0, 0, video.width, video.height);
    vctx.drawImage(bmp, 0, 0, bmp.width, bmp.height, dx, dy, dw, dh);
    bmp.close();
    const mapX = (x) => dx + (x / frame.width) * dw;
    const mapY = (y) => dy + (y / frame.height) * dh;
    const live = frame.tracks.filter((t) => t.confirmed);
    for (const pair of (frame.risk.pairs || []).filter((p) => p.ttc_s != null).slice(0, 8)) {
      const a = live.find((t) => t.id === pair.track_a);
      const b = live.find((t) => t.id === pair.track_b);
      if (!a || !b) continue;
      const hot = pair.ttc_s != null && pair.ttc_s < 2.5;
      vctx.setLineDash([7, 6]);
      vctx.strokeStyle = hot ? COLORS.crit : "rgba(142, 195, 212, 0.45)";
      vctx.lineWidth = hot ? 2.5 : 1.5;
      vctx.beginPath();
      vctx.moveTo(mapX(a.foot[0]), mapY(a.foot[1]));
      vctx.lineTo(mapX(b.foot[0]), mapY(b.foot[1]));
      vctx.stroke();
      vctx.setLineDash([]);
    }
    for (const t of live) {
      const [x1, y1, x2, y2] = t.bbox;
      const color = COLORS[t.class_name] || COLORS.brass;
      const px1 = mapX(x1);
      const py1 = mapY(y1);
      const px2 = mapX(x2);
      const py2 = mapY(y2);
      const low = (t.conf ?? 1) < 0.35;
      const lit = highlightIds.has(t.id) || hoverTrackId === t.id;
      vctx.globalAlpha = low && !lit ? 0.35 : 1;
      vctx.strokeStyle = lit ? COLORS.crit : color;
      vctx.lineWidth = lit ? 3.5 : t.class_name === "worker" ? 2 : 2.5;
      vctx.strokeRect(px1, py1, px2 - px1, py2 - py1);
      drawBoxCorners(vctx, px1, py1, px2, py2, lit ? COLORS.crit : color);
      vctx.fillStyle = lit ? COLORS.crit : color;
      vctx.font = `${Math.max(12, video.width * 0.014)}px Outfit, sans-serif`;
      const confPct = Math.round((t.conf ?? 0) * 100);
      vctx.fillText(
        `${CLASS_LABEL[t.class_name] || t.class_name} ${t.id} · ${confPct}% · a${t.age ?? 0}`,
        px1,
        Math.max(12, py1 - 6)
      );
      const [fu, fv] = t.foot;
      vctx.beginPath();
      vctx.arc(mapX(fu), mapY(fv), lit ? 6 : 4, 0, Math.PI * 2);
      vctx.fill();
      const aim = t.aim_uv;
      if (aim && aim.length === 4) {
        drawHeading(vctx, mapX(aim[0]), mapY(aim[1]), mapX(aim[2]), mapY(aim[3]), color);
      }
      vctx.globalAlpha = 1;
    }
    if (Date.now() > highlightUntil) highlightIds.clear();
    video.onmousemove = (ev) => {
      const rect = video.getBoundingClientRect();
      const sx = ((ev.clientX - rect.left) * video.width) / rect.width;
      const sy = ((ev.clientY - rect.top) * video.height) / rect.height;
      let hit = null;
      for (const t of live) {
        const [x1, y1, x2, y2] = t.bbox;
        const px1 = mapX(x1);
        const py1 = mapY(y1);
        const px2 = mapX(x2);
        const py2 = mapY(y2);
        if (sx >= px1 && sx <= px2 && sy >= py1 && sy <= py2) {
          hit = t.id;
          break;
        }
      }
      if (hit !== hoverTrackId) {
        hoverTrackId = hit;
        if (lastFrame) draw(lastFrame);
      }
    };
    video.onmouseleave = () => {
      if (hoverTrackId != null) {
        hoverTrackId = null;
        if (lastFrame) draw(lastFrame);
      }
    };
    if (calibrating && clicks.length === 4) {
      vctx.beginPath();
      clicks.forEach((pt, i) => (i ? vctx.lineTo(mapX(pt[0]), mapY(pt[1])) : vctx.moveTo(mapX(pt[0]), mapY(pt[1]))));
      vctx.closePath();
      vctx.fillStyle = "rgba(196, 165, 116, 0.16)";
      vctx.fill();
      vctx.strokeStyle = COLORS.brass;
      vctx.lineWidth = 2;
      vctx.stroke();
      vctx.setLineDash([6, 5]);
      vctx.beginPath();
      vctx.moveTo(mapX(clicks[0][0]), mapY(clicks[0][1]));
      vctx.lineTo(mapX(clicks[1][0]), mapY(clicks[1][1]));
      vctx.stroke();
      vctx.setLineDash([]);
      clicks.forEach((pt, i) => {
        vctx.fillStyle = i === 0 ? COLORS.text : COLORS.brass;
        vctx.beginPath();
        vctx.arc(mapX(pt[0]), mapY(pt[1]), 8, 0, Math.PI * 2);
        vctx.fill();
        vctx.strokeStyle = "#131210";
        vctx.lineWidth = 1.5;
        vctx.stroke();
        vctx.fillStyle = COLORS.brass;
        vctx.fillText(CORNER_LABELS[i], mapX(pt[0]) + 10, mapY(pt[1]) - 10);
      });
    }
  });
}

function drawBoxCorners(ctx, x1, y1, x2, y2, color) {
  const len = Math.max(10, Math.min(18, 0.22 * Math.min(x2 - x1, y2 - y1)));
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(x1, y1 + len);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1 + len, y1);
  ctx.moveTo(x2, y1 + len);
  ctx.lineTo(x2, y1);
  ctx.lineTo(x2 - len, y1);
  ctx.moveTo(x1, y2 - len);
  ctx.lineTo(x1, y2);
  ctx.lineTo(x1 + len, y2);
  ctx.moveTo(x2, y2 - len);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x2 - len, y2);
  ctx.stroke();
}

function drawHeading(ctx, x0, y0, x1, y1, color) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const mag = Math.hypot(dx, dy);
  if (mag < 12) return;
  const ang = Math.atan2(dy, dx);
  const head = Math.min(12, mag * 0.28);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(ang - 0.5), y1 - head * Math.sin(ang - 0.5));
  ctx.lineTo(x1 - head * Math.cos(ang + 0.5), y1 - head * Math.sin(ang + 0.5));
  ctx.closePath();
  ctx.fill();
}

function contain(iw, ih, cw, ch) {
  const s = Math.min(cw / iw, ch / ih);
  const dw = iw * s;
  const dh = ih * s;
  return { sx: 0, sy: 0, sw: iw, sh: ih, dx: (cw - dw) / 2, dy: (ch - dh) / 2, dw, dh };
}

function planTargetBounds(frame) {
  const pts = [];
  if (frame.plane?.world_points?.length) pts.push(...frame.plane.world_points);
  for (const z of frame.zones || zones) {
    for (const p of z.polygon || []) pts.push(p);
  }
  for (const p of zoneDraft) pts.push(p);
  for (const t of frame.tracks || []) {
    if (!t.confirmed || t.x_m == null || t.y_m == null) continue;
    if (!Number.isFinite(t.x_m) || !Number.isFinite(t.y_m)) continue;
    if (Math.abs(t.x_m) > 80 || Math.abs(t.y_m) > 80) continue;
    pts.push([t.x_m, t.y_m]);
    for (const h of t.history_m || []) {
      if (Math.abs(h[0]) <= 80 && Math.abs(h[1]) <= 80) pts.push(h);
    }
  }
  if (!pts.length) pts.push([0, 0], [12, 10]);
  const pad = 2.4;
  return {
    minX: Math.min(...pts.map((p) => p[0])) - pad,
    maxX: Math.max(...pts.map((p) => p[0])) + pad,
    minY: Math.min(...pts.map((p) => p[1])) - pad,
    maxY: Math.max(...pts.map((p) => p[1])) + pad,
  };
}

function settlePlanBounds(target) {
  if (!planBounds) {
    planBounds = { ...target };
    return planBounds;
  }
  const k = 0.04;
  planBounds = {
    minX: Math.min(planBounds.minX, target.minX) + k * Math.max(0, target.minX - planBounds.minX),
    maxX: Math.max(planBounds.maxX, target.maxX) + k * Math.min(0, target.maxX - planBounds.maxX),
    minY: Math.min(planBounds.minY, target.minY) + k * Math.max(0, target.minY - planBounds.minY),
    maxY: Math.max(planBounds.maxY, target.maxY) + k * Math.min(0, target.maxY - planBounds.maxY),
  };
  return planBounds;
}

function cross3(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function mul3(R, v) {
  return [
    R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
    R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
    R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
  ];
}

function transpose3(R) {
  return [
    [R[0][0], R[1][0], R[2][0]],
    [R[0][1], R[1][1], R[2][1]],
    [R[0][2], R[1][2], R[2][2]],
  ];
}

function makeCameraProjector(frame) {
  const cam = frame.camera;
  const K = cam.K;
  const R = cam.R;
  const t = cam.t;
  const { minX, minY, maxX, maxY } = settlePlanBounds(planTargetBounds(frame));
  const { dx, dy, dw, dh } = contain(frame.width, frame.height, plan.width, plan.height);
  const RT = transpose3(R);
  const eye = cam.eye || mul3(RT, t.map((v) => -v));

  function project(x, y, z = 0) {
    const X = R[0][0] * x + R[0][1] * y + R[0][2] * z + t[0];
    const Y = R[1][0] * x + R[1][1] * y + R[1][2] * z + t[1];
    const Z = R[2][0] * x + R[2][1] * y + R[2][2] * z + t[2];
    if (Z < 0.35) return null;
    const u = (K[0][0] * X) / Z + K[0][2];
    const v = (K[1][1] * Y) / Z + K[1][2];
    return {
      x: dx + (u / frame.width) * dw,
      y: dy + (v / frame.height) * dh,
      d: Z,
    };
  }

  function unproject(sx, sy) {
    const u = ((sx - dx) / Math.max(dw, 1)) * frame.width;
    const v = ((sy - dy) / Math.max(dh, 1)) * frame.height;
    const dirC = [(u - K[0][2]) / K[0][0], (v - K[1][2]) / K[1][1], 1];
    const dirW = mul3(RT, dirC);
    if (Math.abs(dirW[2]) < 1e-6) return null;
    const lam = -eye[2] / dirW[2];
    if (lam < 0.2) return null;
    return [eye[0] + dirW[0] * lam, eye[1] + dirW[1] * lam];
  }

  return { project, unproject, minX, minY, maxX, maxY };
}

function makePlanProjector(frame) {
  if (planCam.matchCam && frame.camera?.K && frame.camera?.R && frame.camera?.t) {
    return makeCameraProjector(frame);
  }
  const { minX, minY, maxX, maxY } = settlePlanBounds(planTargetBounds(frame));
  const cx = 0.5 * (minX + maxX);
  const cy = 0.5 * (minY + maxY);
  const span = Math.max(maxX - minX, maxY - minY, 4);
  const want = span * 0.85;
  if (planCam.dist == null) planCam.dist = want;
  else if (!planCam.userDist) planCam.dist += 0.08 * (want - planCam.dist);
  const yaw = planCam.yaw;
  const pitch = planCam.pitch;
  const dist = planCam.dist;
  const cp = Math.cos(pitch);
  const eye = {
    x: cx + Math.sin(yaw) * cp * dist,
    y: cy + Math.cos(yaw) * cp * dist,
    z: Math.max(2.2, Math.sin(pitch) * dist),
  };
  const look = { x: cx - eye.x, y: cy - eye.y, z: 0 - eye.z };
  const fl = Math.hypot(look.x, look.y, look.z) || 1;
  const fwd = { x: look.x / fl, y: look.y / fl, z: look.z / fl };
  let right = cross3(fwd, { x: 0, y: 0, z: 1 });
  let rl = Math.hypot(right.x, right.y, right.z);
  if (rl < 1e-6) right = { x: 1, y: 0, z: 0 };
  else right = { x: right.x / rl, y: right.y / rl, z: right.z / rl };
  const up = cross3(right, fwd);
  const fLen = Math.min(plan.width, plan.height) * 1.22;

  function project(x, y, z = 0) {
    const dx = x - eye.x;
    const dy = y - eye.y;
    const dz = z - eye.z;
    const cz = dx * fwd.x + dy * fwd.y + dz * fwd.z;
    if (cz < 0.25) return null;
    const camX = dx * right.x + dy * right.y + dz * right.z;
    const camY = dx * up.x + dy * up.y + dz * up.z;
    return {
      x: plan.width / 2 + (camX / cz) * fLen,
      y: plan.height / 2 - (camY / cz) * fLen,
      d: cz,
    };
  }

  function unproject(sx, sy) {
    const nx = (sx - plan.width / 2) / fLen;
    const ny = (plan.height / 2 - sy) / fLen;
    const dir = {
      x: nx * right.x + ny * up.x + fwd.x,
      y: nx * right.y + ny * up.y + fwd.y,
      z: nx * right.z + ny * up.z + fwd.z,
    };
    const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
    dir.x /= dl;
    dir.y /= dl;
    dir.z /= dl;
    if (Math.abs(dir.z) < 1e-5) return null;
    const t = -eye.z / dir.z;
    if (t < 0.2) return null;
    return [eye.x + dir.x * t, eye.y + dir.y * t];
  }

  return { project, unproject, minX, minY, maxX, maxY };
}

function pathProjected(ctx, pts, project, close = false) {
  let started = false;
  for (const p of pts) {
    const q = project(p[0], p[1], p[2] || 0);
    if (!q) continue;
    if (!started) {
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      started = true;
    } else {
      ctx.lineTo(q.x, q.y);
    }
  }
  if (!started) return false;
  if (close) ctx.closePath();
  return true;
}

function drawGroundPoly(ctx, pts, project, fill, stroke) {
  if (!pathProjected(ctx, pts.map((p) => [p[0], p[1], 0]), project, true)) return;
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function headingXY(t) {
  const ready = t.heading_ready === true;
  const h = Math.hypot(t.hx || 0, t.hy || 0);
  if (ready && h > 0.2) return [t.hx / h, t.hy / h];
  const sp = Math.hypot(t.vx_mps || 0, t.vy_mps || 0);
  if (sp > 0.45) return [t.vx_mps / sp, t.vy_mps / sp];
  return [1, 0];
}

function orientedCorners(x, y, hx, hy, px, py, ol, ow, hl, hw) {
  const cx = x + hx * ol + px * ow;
  const cy = y + hy * ol + py * ow;
  return [
    [cx + hx * hl + px * hw, cy + hy * hl + py * hw],
    [cx + hx * hl - px * hw, cy + hy * hl - py * hw],
    [cx - hx * hl - px * hw, cy - hy * hl - py * hw],
    [cx - hx * hl + px * hw, cy - hy * hl + py * hw],
  ];
}

function boxQuads(x, y, hx, hy, px, py, ol, ow, hl, hw, z0, z1) {
  const c = orientedCorners(x, y, hx, hy, px, py, ol, ow, hl, hw);
  return [
    { pts: c.map((p) => [p[0], p[1], z1]), kind: "top" },
    {
      pts: [
        [c[0][0], c[0][1], z0],
        [c[1][0], c[1][1], z0],
        [c[1][0], c[1][1], z1],
        [c[0][0], c[0][1], z1],
      ],
      kind: "front",
    },
    {
      pts: [
        [c[2][0], c[2][1], z0],
        [c[3][0], c[3][1], z0],
        [c[3][0], c[3][1], z1],
        [c[2][0], c[2][1], z1],
      ],
      kind: "back",
    },
    {
      pts: [
        [c[1][0], c[1][1], z0],
        [c[2][0], c[2][1], z0],
        [c[2][0], c[2][1], z1],
        [c[1][0], c[1][1], z1],
      ],
      kind: "side",
    },
    {
      pts: [
        [c[3][0], c[3][1], z0],
        [c[0][0], c[0][1], z0],
        [c[0][0], c[0][1], z1],
        [c[3][0], c[3][1], z1],
      ],
      kind: "side",
    },
  ];
}

function personMesh(x, y, hx, hy, px, py, heightM) {
  const s = Math.max(0.45, heightM || 1.7) / 1.58;
  return [
    ...boxQuads(x, y, hx, hy, px, py, 0.02, 0.08, 0.06, 0.05, 0, 0.78 * s),
    ...boxQuads(x, y, hx, hy, px, py, 0.02, -0.08, 0.06, 0.05, 0, 0.78 * s),
    ...boxQuads(x, y, hx, hy, px, py, 0, 0, 0.1, 0.18, 0.76 * s, 1.3 * s),
    ...boxQuads(x, y, hx, hy, px, py, 0, 0.23, 0.05, 0.04, 0.74 * s, 1.26 * s),
    ...boxQuads(x, y, hx, hy, px, py, 0, -0.23, 0.05, 0.04, 0.74 * s, 1.26 * s),
    ...boxQuads(x, y, hx, hy, px, py, 0.02, 0, 0.08, 0.08, 1.32 * s, 1.58 * s),
  ];
}

function carMesh(x, y, hx, hy, px, py, halfL, halfW) {
  const L = Math.max(0.85, halfL);
  const W = Math.max(0.42, halfW);
  const faces = [];
  const wheelR = Math.min(0.16, L * 0.13);
  const wheelT = Math.min(0.06, W * 0.14);
  for (const ol of [L * 0.56, -L * 0.56]) {
    for (const ow of [W * 0.9, -W * 0.9]) {
      faces.push(...boxQuads(x, y, hx, hy, px, py, ol, ow, wheelR, wheelT, 0, wheelR * 1.65));
    }
  }
  faces.push(...boxQuads(x, y, hx, hy, px, py, 0, 0, L, W, 0.1, 0.4));
  faces.push(...boxQuads(x, y, hx, hy, px, py, L * 0.62, 0, L * 0.32, W * 0.9, 0.4, 0.52));
  faces.push(...boxQuads(x, y, hx, hy, px, py, -L * 0.28, 0, L * 0.38, W * 0.8, 0.4, 1.0));
  const cW = W * 0.8;
  const hoodZ = 0.52;
  const roofZ = 1.0;
  faces.push({
    pts: [
      [x + hx * L * 0.3 + px * cW, y + hy * L * 0.3 + py * cW, hoodZ],
      [x + hx * L * 0.3 - px * cW, y + hy * L * 0.3 - py * cW, hoodZ],
      [x + hx * L * 0.1 - px * cW, y + hy * L * 0.1 - py * cW, roofZ],
      [x + hx * L * 0.1 + px * cW, y + hy * L * 0.1 + py * cW, roofZ],
    ],
    kind: "front",
  });
  return faces;
}

function plantMesh(x, y, hx, hy, px, py, halfL, halfW) {
  const L = Math.max(1.1, halfL);
  const W = Math.max(0.55, halfW);
  return [
    ...boxQuads(x, y, hx, hy, px, py, 0, 0, L, W, 0, 0.7),
    ...boxQuads(x, y, hx, hy, px, py, -L * 0.28, 0, L * 0.36, W * 0.7, 0.7, 2.1),
    ...boxQuads(x, y, hx, hy, px, py, L * 0.32, 0, L * 0.48, W * 0.16, 1.0, 1.28),
  ];
}

function meshForTrack(t, hx, hy, px, py) {
  if (t.class_name === "worker") return personMesh(t.x_m, t.y_m, hx, hy, px, py, t.height_m || 1.7);
  const halfL = Math.max(0.85, (t.length_m || 2.4) * 0.5);
  const halfW = Math.max(0.42, (t.width_m || 1.5) * 0.5);
  if (t.class_name === "vehicle") return carMesh(t.x_m, t.y_m, hx, hy, px, py, halfL, halfW);
  return plantMesh(t.x_m, t.y_m, hx, hy, px, py, halfL, halfW);
}

function faceShade(pts) {
  if (!pts || pts.length < 3) return 0.28;
  const a = pts[0];
  const b = pts[1];
  const c = pts[2];
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = (b[2] || 0) - (a[2] || 0);
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = (c[2] || 0) - (a[2] || 0);
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const mag = Math.hypot(nx, ny, nz) || 1;
  nx /= mag;
  ny /= mag;
  nz /= mag;
  const lit = Math.max(0, nx * 0.28 + ny * 0.18 + nz * 0.92);
  return 0.16 + 0.38 * lit;
}

function drawMesh(ctx, faces, project, color) {
  const ranked = faces
    .map((face) => {
      const mids = face.pts.map((p) => project(p[0], p[1], p[2])).filter(Boolean);
      const d = mids.length ? mids.reduce((s, q) => s + q.d, 0) / mids.length : 0;
      return { ...face, d, shade: faceShade(face.pts) };
    })
    .sort((a, b) => b.d - a.d);
  for (const face of ranked) {
    if (!pathProjected(ctx, face.pts, project, true)) continue;
    ctx.fillStyle = color;
    ctx.globalAlpha = face.shade;
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function ensureMapImage(meta) {
  return new Promise((resolve) => {
    if (!meta?.image) {
      mapImage = null;
      mapMetaKey = "";
      resolve(null);
      return;
    }
    const key = `${meta.image}|${JSON.stringify(meta.world_rect || null)}`;
    if (mapImage && mapMetaKey === key) {
      resolve(mapImage);
      return;
    }
    const img = new Image();
    img.onload = () => {
      mapImage = img;
      mapMetaKey = key;
      resolve(img);
    };
    img.onerror = () => {
      mapImage = null;
      mapMetaKey = "";
      resolve(null);
    };
    img.src = `/${meta.image}?t=${Date.now()}`;
  });
}

function nearestTrackAt(pt, frame, maxDist = 2.0) {
  if (!pt || !frame?.tracks) return null;
  let best = null;
  let bestD = maxDist;
  for (const t of frame.tracks) {
    if (!t.confirmed || t.x_m == null) continue;
    const d = Math.hypot(t.x_m - pt[0], t.y_m - pt[1]);
    const reach = maxDist + Math.max(0.4, (t.radius_m || 0.5) * 0.5);
    if (d <= reach && d < bestD) {
      bestD = d;
      best = t.id;
    }
  }
  return best;
}

function drawWorldCircle(ctx, x, y, radius, project, fill, stroke, width = 1) {
  if (!(radius > 0.05)) return;
  const n = Math.max(20, Math.min(48, Math.round(radius * 10)));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([x + Math.cos(a) * radius, y + Math.sin(a) * radius, 0.01]);
  }
  if (!pathProjected(ctx, pts, project, true)) return;
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function drawTexturedTri(ctx, img, d0, d1, d2, s0, s1, s2) {
  const x0 = d0.x;
  const y0 = d0.y;
  const x1 = d1.x;
  const y1 = d1.y;
  const x2 = d2.x;
  const y2 = d2.y;
  const u0 = s0[0];
  const v0 = s0[1];
  const u1 = s1[0];
  const v1 = s1[1];
  const u2 = s2[0];
  const v2 = s2[1];
  const denom = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
  if (Math.abs(denom) < 1e-6) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.closePath();
  ctx.clip();
  const m11 = (x0 * (v1 - v2) + x1 * (v2 - v0) + x2 * (v0 - v1)) / denom;
  const m12 = (x0 * (u2 - u1) + x1 * (u0 - u2) + x2 * (u1 - u0)) / denom;
  const m21 = (y0 * (v1 - v2) + y1 * (v2 - v0) + y2 * (v0 - v1)) / denom;
  const m22 = (y0 * (u2 - u1) + y1 * (u0 - u2) + y2 * (u1 - u0)) / denom;
  const dx = (x0 * (u1 * v2 - u2 * v1) + x1 * (u2 * v0 - u0 * v2) + x2 * (u0 * v1 - u1 * v0)) / denom;
  const dy = (y0 * (u1 * v2 - u2 * v1) + y1 * (u2 * v0 - u0 * v2) + y2 * (u0 * v1 - u1 * v0)) / denom;
  ctx.setTransform(m11, m21, m12, m22, dx, dy);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function drawMapUnderlay(ctx, frame, project) {
  if (!showMap || !mapImage || !frame.map) return;
  const quad =
    (frame.map.world_rect && frame.map.world_rect.length >= 4
      ? frame.map.world_rect
      : frame.plane?.world_points) || null;
  if (!quad || quad.length < 4) return;
  const w = mapImage.naturalWidth || mapImage.width;
  const h = mapImage.naturalHeight || mapImage.height;
  if (!w || !h) return;
  const steps = 6;
  ctx.globalAlpha = 0.42;
  for (let iy = 0; iy < steps; iy++) {
    for (let ix = 0; ix < steps; ix++) {
      const u0 = ix / steps;
      const u1 = (ix + 1) / steps;
      const v0 = iy / steps;
      const v1 = (iy + 1) / steps;
      const lerp = (a, b, t) => a + (b - a) * t;
      const bil = (uu, vv) => {
        const top = [
          lerp(quad[0][0], quad[1][0], uu),
          lerp(quad[0][1], quad[1][1], uu),
        ];
        const bot = [
          lerp(quad[3][0], quad[2][0], uu),
          lerp(quad[3][1], quad[2][1], uu),
        ];
        return [lerp(top[0], bot[0], vv), lerp(top[1], bot[1], vv)];
      };
      const w00 = bil(u0, v0);
      const w10 = bil(u1, v0);
      const w11 = bil(u1, v1);
      const w01 = bil(u0, v1);
      const p00 = project(w00[0], w00[1], 0);
      const p10 = project(w10[0], w10[1], 0);
      const p11 = project(w11[0], w11[1], 0);
      const p01 = project(w01[0], w01[1], 0);
      if (!p00 || !p10 || !p11 || !p01) continue;
      const s00 = [u0 * w, v0 * h];
      const s10 = [u1 * w, v0 * h];
      const s11 = [u1 * w, v1 * h];
      const s01 = [u0 * w, v1 * h];
      drawTexturedTri(ctx, mapImage, p00, p10, p11, s00, s10, s11);
      drawTexturedTri(ctx, mapImage, p00, p11, p01, s00, s11, s01);
    }
  }
  ctx.globalAlpha = 1;
  drawGroundPoly(ctx, quad, project, null, "rgba(242,239,232,0.28)");
}

function drawPlanGrid(ctx, project, minX, minY, maxX, maxY) {
  const gx0 = Math.floor(minX);
  const gx1 = Math.ceil(maxX);
  const gy0 = Math.floor(minY);
  const gy1 = Math.ceil(maxY);
  for (let x = gx0; x <= gx1; x++) {
    const major = x % 5 === 0;
    ctx.strokeStyle = major ? COLORS.gridMajor : COLORS.grid;
    ctx.lineWidth = major ? 1.4 : 1;
    if (
      pathProjected(
        ctx,
        [
          [x, minY, 0],
          [x, maxY, 0],
        ],
        project
      )
    ) {
      ctx.stroke();
    }
  }
  for (let y = gy0; y <= gy1; y++) {
    const major = y % 5 === 0;
    ctx.strokeStyle = major ? COLORS.gridMajor : COLORS.grid;
    ctx.lineWidth = major ? 1.4 : 1;
    if (
      pathProjected(
        ctx,
        [
          [minX, y, 0],
          [maxX, y, 0],
        ],
        project
      )
    ) {
      ctx.stroke();
    }
  }
}

function drawScaleBar(ctx, unproject) {
  if (!unproject) return;
  const y = plan.height * 0.72;
  const a = unproject(plan.width * 0.5 - 50, y);
  const b = unproject(plan.width * 0.5 + 50, y);
  if (!a || !b) return;
  const meters = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(meters > 0.05)) return;
  const candidates = [1, 2, 5, 10, 20, 50, 100];
  let nice = candidates[0];
  for (const c of candidates) {
    if (c <= meters * 1.15) nice = c;
  }
  const px = Math.max(36, Math.min(160, (100 * nice) / meters));
  const x0 = 20;
  const y0 = plan.height - 22;
  ctx.fillStyle = "rgba(13,12,11,0.55)";
  ctx.fillRect(x0 - 6, y0 - 18, px + 48, 28);
  ctx.strokeStyle = COLORS.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + px, y0);
  ctx.moveTo(x0, y0 - 5);
  ctx.lineTo(x0, y0 + 5);
  ctx.moveTo(x0 + px, y0 - 5);
  ctx.lineTo(x0 + px, y0 + 5);
  ctx.stroke();
  ctx.fillStyle = COLORS.text;
  ctx.font = "11px Outfit, sans-serif";
  ctx.fillText(`${nice} m`, x0 + px + 8, y0 + 4);
}

function drawPathRibbon(ctx, history, project, color) {
  if (!history || history.length < 2) return;
  for (let i = 1; i < history.length; i++) {
    const a = i / (history.length - 1);
    ctx.globalAlpha = 0.12 + 0.55 * a;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 + 2.8 * a;
    ctx.lineCap = "round";
    pathProjected(
      ctx,
      [
        [history[i - 1][0], history[i - 1][1], 0.02],
        [history[i][0], history[i][1], 0.02],
      ],
      project
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = "butt";
}

function drawClearanceDiscs(ctx, t, project, thresholds) {
  if (!showClearance || t.x_m == null) return;
  const base = Math.max(0.35, t.radius_m || 0.5);
  const adv = base + Number(thresholds?.advisory_distance_m ?? 4);
  const warn = base + Number(thresholds?.warning_distance_m ?? 2);
  const crit = base + Number(thresholds?.critical_distance_m ?? 0.5);
  drawWorldCircle(ctx, t.x_m, t.y_m, adv, project, COLORS.clearanceAdv, "rgba(142,195,212,0.22)", 1);
  drawWorldCircle(ctx, t.x_m, t.y_m, warn, project, COLORS.clearanceWarn, "rgba(224,160,90,0.35)", 1.2);
  drawWorldCircle(ctx, t.x_m, t.y_m, crit, project, COLORS.clearanceCrit, "rgba(212,91,74,0.45)", 1.4);
  drawWorldCircle(ctx, t.x_m, t.y_m, base, project, null, "rgba(242,239,232,0.35)", 1);
}

function drawFloorBox(ctx, t, project, color, lit) {
  const [hx, hy] = headingXY(t);
  const px = -hy;
  const py = hx;
  const halfL = t.class_name === "worker" ? 0.28 : Math.max(0.85, (t.length_m || 2.4) * 0.5);
  const halfW = t.class_name === "worker" ? 0.22 : Math.max(0.42, (t.width_m || 1.5) * 0.5);
  const corners = orientedCorners(t.x_m, t.y_m, hx, hy, px, py, 0, 0, halfL, halfW);
  drawGroundPoly(ctx, corners, project, lit ? "rgba(212,91,74,0.22)" : "rgba(8,7,6,0.42)", lit ? COLORS.crit : color);
  const tip = [t.x_m + hx * halfL * 1.2, t.y_m + hy * halfL * 1.2];
  const left = [t.x_m + hx * halfL * 0.45 + px * halfW * 0.85, t.y_m + hy * halfL * 0.45 + py * halfW * 0.85];
  const right = [t.x_m + hx * halfL * 0.45 - px * halfW * 0.85, t.y_m + hy * halfL * 0.45 - py * halfW * 0.85];
  ctx.strokeStyle = lit ? COLORS.crit : color;
  ctx.lineWidth = lit ? 2.4 : 1.6;
  pathProjected(
    ctx,
    [
      [left[0], left[1], 0.03],
      [tip[0], tip[1], 0.03],
      [right[0], right[1], 0.03],
    ],
    project
  );
  ctx.stroke();
}

function drawActor(ctx, t, project, lit = false) {
  const h = t.height_m || HEIGHT_M[t.class_name] || 1.8;
  const [hx, hy] = headingXY(t);
  const px = -hy;
  const py = hx;
  const color = COLORS[t.class_name] || COLORS.brass;
  drawFloorBox(ctx, t, project, color, lit);
  drawMesh(ctx, meshForTrack(t, hx, hy, px, py), project, color);
  const top = project(t.x_m, t.y_m, h);
  if (top) {
    ctx.fillStyle = lit ? COLORS.crit : color;
    ctx.font = "12px Outfit, sans-serif";
    ctx.fillText(`${CLASS_MARK[t.class_name] || t.class_name[0].toUpperCase()}${t.id}`, top.x + 6, top.y - 4);
  }
}

function drawPlan(frame) {
  fitCanvas(plan);
  pctx.setTransform(1, 0, 0, 1, 0, 0);
  pctx.fillStyle = "#0d0c0b";
  pctx.fillRect(0, 0, plan.width, plan.height);
  if (!frame.calibrated) {
    planView = null;
    planBounds = null;
    pctx.fillStyle = COLORS.muted;
    pctx.font = `${Math.max(16, plan.width * 0.03)}px Fraunces, serif`;
    pctx.fillText("No ground plane", 28, plan.height / 2);
    pctx.font = `${Math.max(12, plan.width * 0.018)}px Outfit, sans-serif`;
    pctx.fillText("Calibrate a known rectangle on the street (crossing, lane, or plaza).", 28, plan.height / 2 + 28);
    return;
  }

  if (frame.map) {
    ensureMapImage(frame.map).then((img) => {
      if (img && showMap) mapBtn?.classList.add("active");
    });
  } else if (!frame.map && mapMetaKey) {
    mapImage = null;
    mapMetaKey = "";
  }

  const cam = makePlanProjector(frame);
  const { project, unproject, minX, minY, maxX, maxY } = cam;
  planView = cam;

  pctx.lineWidth = 1;
  drawGroundPoly(
    pctx,
    [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ],
    project,
    "rgba(242,239,232,0.035)",
    null
  );

  drawMapUnderlay(pctx, frame, project);
  drawPlanGrid(pctx, project, minX, minY, maxX, maxY);

  if (frame.fov_m && frame.fov_m.length >= 3) {
    drawGroundPoly(pctx, frame.fov_m, project, COLORS.fov, COLORS.fovStroke);
  }

  pctx.fillStyle = COLORS.muted;
  pctx.font = "12px Outfit, sans-serif";
  const camLabel = planCam.matchCam && frame.camera ? "camera match" : "orbit";
  pctx.fillText(`3D ${camLabel} · FOV · clearance · click tracks`, 16, 22);

  if (frame.plane) {
    const q = frame.plane.world_points;
    drawGroundPoly(pctx, q, project, "rgba(196,165,116,0.1)", COLORS.brass);
    const origin = q[0];
    const axis = [
      { pts: [origin, [origin[0] + 2, origin[1], 0]], color: "#d45b4a", label: "+X" },
      { pts: [origin, [origin[0], origin[1] + 2, 0]], color: "#8ec3d4", label: "+Y" },
      { pts: [[origin[0], origin[1], 0], [origin[0], origin[1], 2]], color: "#c4a574", label: "+Z" },
    ];
    for (const a of axis) {
      const pts = a.pts.map((p) => (p.length === 2 ? [p[0], p[1], 0] : p));
      pctx.strokeStyle = a.color;
      pctx.lineWidth = 2;
      pathProjected(pctx, pts, project);
      pctx.stroke();
    }
  }

  const allZones = [...(frame.zones || zones)];
  if (showHeatmap && frame.heatmap?.cells?.length) {
    const ox = frame.heatmap.origin_m[0];
    const oy = frame.heatmap.origin_m[1];
    const cell = frame.heatmap.cell_m || 0.5;
    for (const c of frame.heatmap.cells) {
      const x0 = ox + c.x * cell;
      const y0 = oy + c.y * cell;
      const quad = [
        [x0, y0, 0],
        [x0 + cell, y0, 0],
        [x0 + cell, y0 + cell, 0],
        [x0, y0 + cell, 0],
      ];
      if (!pathProjected(pctx, quad, project, true)) continue;
      pctx.fillStyle = `rgba(224, 160, 90, ${0.12 + 0.55 * (c.v || 0)})`;
      pctx.fill();
    }
  }
  for (const z of allZones) {
    const kind = z.kind || "exclusion";
    const colors = ZONE_COLORS[kind] || ZONE_COLORS.exclusion;
    const selected = z.id === selectedZoneId;
    if (kind === "tripwire") {
      const a = z.a || (z.polygon || [])[0];
      const b = z.b || (z.polygon || [])[1];
      if (!a || !b) continue;
      pctx.strokeStyle = colors.stroke;
      pctx.lineWidth = selected ? 5 : 3;
      pathProjected(pctx, [[a[0], a[1], 0], [b[0], b[1], 0]], project);
      pctx.stroke();
      const mid = project((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.3);
      if (mid) {
        const count = (frame.risk?.trip_counts || {})[z.id] || 0;
        pctx.fillStyle = colors.stroke;
        pctx.fillText(`${z.name || "Wire"} · ${count}`, mid.x, mid.y - 6);
      }
      continue;
    }
    const poly = z.polygon || [];
    if (poly.length < 3) continue;
    drawGroundPoly(pctx, poly, project, colors.fill, colors.stroke);
    if (selected) {
      pctx.lineWidth = 3;
      pathProjected(pctx, poly.map((p) => [p[0], p[1], 0.02]), project);
      pctx.strokeStyle = COLORS.brass;
      pctx.stroke();
      pctx.lineWidth = 1;
    }
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const quad = [
        [a[0], a[1], 0],
        [b[0], b[1], 0],
        [b[0], b[1], 0.35],
        [a[0], a[1], 0.35],
      ];
      if (!pathProjected(pctx, quad, project, true)) continue;
      pctx.fillStyle = colors.fill;
      pctx.fill();
      pctx.strokeStyle = colors.stroke;
      pctx.stroke();
    }
    const label = project(poly[0][0], poly[0][1], 0.4);
    if (label) {
      pctx.fillStyle = colors.stroke;
      pctx.fillText(z.name || kind, label.x, label.y - 6);
    }
  }

  if (zoneDraft.length) {
    pctx.strokeStyle = COLORS.brass;
    pctx.setLineDash([6, 4]);
    pathProjected(
      pctx,
      zoneDraft.map((p) => [p[0], p[1], 0]),
      project
    );
    pctx.stroke();
    pctx.setLineDash([]);
    for (const p of zoneDraft) {
      const q = project(p[0], p[1], 0);
      if (!q) continue;
      pctx.beginPath();
      pctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
      pctx.fillStyle = COLORS.brass;
      pctx.fill();
    }
  }

  for (const pair of (frame.risk.pairs || []).filter((p) => p.ttc_s != null).slice(0, 8)) {
    const a = frame.tracks.find((t) => t.id === pair.track_a);
    const b = frame.tracks.find((t) => t.id === pair.track_b);
    if (!a || !b || a.x_m == null || b.x_m == null) continue;
    pctx.strokeStyle = pair.ttc_s != null && pair.ttc_s < 2.5 ? COLORS.crit : COLORS.muted;
    pctx.lineWidth = 1.5;
    pathProjected(
      pctx,
      [
        [a.x_m, a.y_m, 0.05],
        [b.x_m, b.y_m, 0.05],
      ],
      project
    );
    pctx.stroke();
    if (pair.ttc_s != null) {
      const mid = project((a.x_m + b.x_m) / 2, (a.y_m + b.y_m) / 2, 0.2);
      if (mid) {
        pctx.fillStyle = COLORS.text;
        pctx.fillText(`${pair.ttc_s.toFixed(1)}s`, mid.x, mid.y);
      }
    }
  }

  const hitIds = new Set((frame.risk.zone_hits || []).map((h) => h.track_id));
  for (const id of highlightIds) hitIds.add(id);
  if (hoverTrackId != null) hitIds.add(hoverTrackId);
  const live = frame.tracks.filter((t) => t.confirmed && t.x_m != null);
  live.sort((a, b) => {
    const pa = project(a.x_m, a.y_m, 0);
    const pb = project(b.x_m, b.y_m, 0);
    return (pb?.d || 0) - (pa?.d || 0);
  });
  const thresholds = frame.risk_thresholds || {};
  for (const t of live) {
    drawClearanceDiscs(pctx, t, project, thresholds);
    drawPathRibbon(pctx, t.history_m, project, COLORS[t.class_name] || COLORS.brass);
    const moving = (t.speed_mps || 0) > 0.25;
    if (moving && t.forecast_m && t.forecast_m.length) {
      pctx.beginPath();
      pctx.setLineDash([5, 5]);
      pctx.strokeStyle = COLORS.forecast;
      pathProjected(
        pctx,
        [[t.x_m, t.y_m, 0.04], ...t.forecast_m.map((p) => [p[0], p[1], 0.04])],
        project
      );
      pctx.stroke();
      pctx.setLineDash([]);
    }
    drawActor(pctx, t, project, hitIds.has(t.id));
    if (hitIds.has(t.id)) {
      const foot = project(t.x_m, t.y_m, 0.02);
      if (foot) {
        pctx.strokeStyle = COLORS.crit;
        pctx.lineWidth = 2;
        pctx.beginPath();
        pctx.arc(foot.x, foot.y, 12, 0, Math.PI * 2);
        pctx.stroke();
      }
    }
  }

  drawScaleBar(pctx, unproject);
}

function flashTracks(...ids) {
  highlightIds = new Set(ids.filter((x) => x != null).map(Number));
  highlightUntil = Date.now() + 2500;
  if (lastFrame) draw(lastFrame);
}

function fillTables(frame) {
  const pairs = document.getElementById("pair-rows");
  if (!pairs) return;
  const rows = frame.risk.pairs || [];
  pairs.innerHTML = rows.length
    ? rows
        .map((p) => {
          const a = CLASS_MARK[p.class_a] || "P";
          const b = CLASS_MARK[p.class_b] || "V";
          const clr = p.clearance_m != null ? p.clearance_m : p.distance_m;
          return `<tr class="clickable" data-a="${p.track_a}" data-b="${p.track_b}">
            <td>${a}${p.track_a}–${b}${p.track_b}</td>
            <td>${clr.toFixed(1)} m</td>
            <td>${p.ttc_s == null ? "—" : p.ttc_s.toFixed(2) + " s"}</td>
            <td>${p.closing ? "yes" : "no"}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="4">${frame.calibrated ? "No person–hazard pairs this frame" : "Calibrate to score pairs"}</td></tr>`;
  pairs.querySelectorAll("tr.clickable").forEach((tr) => {
    tr.addEventListener("click", () => flashTracks(tr.dataset.a, tr.dataset.b));
  });
}

function fillEvents(frame) {
  const body = document.getElementById("event-rows");
  if (!body) return;
  const rows = frame.events || [];
  body.innerHTML = rows.length
    ? rows
        .slice()
        .reverse()
        .map((e) => {
          const metric =
            e.kind === "tripwire"
              ? "—"
              : [
                  e.ttc_s == null ? null : `${e.ttc_s} s`,
                  e.clearance_m == null && e.distance_m == null
                    ? null
                    : `${e.clearance_m ?? e.distance_m} m`,
                ]
                  .filter(Boolean)
                  .join(" / ") || "—";
          return `<tr class="clickable" data-a="${e.track_a ?? ""}" data-b="${e.track_b ?? ""}">
            <td>${e.frame}</td>
            <td title="${e.event_code || ""}">${e.event_label || e.alarm}</td>
            <td>${metric}</td>
            <td>${e.detail || (e.zone_hits ? `${e.zone_hits} zone` : "—")}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="4">${frame.calibrated ? "No warning/critical events yet" : "Calibrate to score conflicts"}</td></tr>`;
  body.querySelectorAll("tr.clickable").forEach((tr) => {
    tr.addEventListener("click", () => flashTracks(tr.dataset.a || null, tr.dataset.b || null));
  });
}

function scheduleBriefing() {
  if (briefingTimer) return;
  briefingTimer = window.setTimeout(() => {
    briefingTimer = 0;
    refreshBriefing();
  }, 1200);
}

async function refreshBriefing() {
  try {
    const note = await fetch("/api/briefing").then((r) => r.json());
    document.getElementById("briefing").textContent = note.body;
  } catch {
    /* ignore */
  }
}

document.querySelectorAll(".label-row button").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const res = await fetch("/api/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: btn.dataset.kind }),
    });
    const data = await res.json();
    const status = document.getElementById("label-status");
    if (!res.ok) {
      status.textContent = data.detail || "Label failed";
      return;
    }
    status.textContent = `Saved ${data.label.kind} at frame ${data.label.frame_index}.`;
  });
});

const setupOverlay = document.getElementById("setup-overlay");
const setupBtn = document.getElementById("btn-setup");

function num(id) {
  return parseFloat(document.getElementById(id).value);
}

function fillSetup(data) {
  const cfg = data.config || {};
  const det = cfg.detector || {};
  const classes = cfg.classes || {};
  const trk = cfg.tracker || {};
  const risk = cfg.risk || {};
  const stream = cfg.stream || {};
  const privacy = cfg.privacy || {};

  const weightSel = document.getElementById("setup-weights");
  const current = det.weights || "";
  weightSel.innerHTML = "";
  const weights = data.weights || [];
  if (!weights.length) {
    const opt = document.createElement("option");
    opt.value = current;
    opt.textContent = current || "No weights found";
    weightSel.appendChild(opt);
  } else {
    for (const w of weights) {
      const opt = document.createElement("option");
      opt.value = w.path;
      opt.textContent = `${w.name} · ${w.kind} · ${w.size_mb} MB`;
      if (w.path === current) opt.selected = true;
      weightSel.appendChild(opt);
    }
    if (current && ![...weightSel.options].some((o) => o.value === current)) {
      const opt = document.createElement("option");
      opt.value = current;
      opt.textContent = current;
      opt.selected = true;
      weightSel.appendChild(opt);
    }
  }

  document.getElementById("setup-det-conf").value = det.conf ?? 0.18;
  document.getElementById("setup-det-iou").value = det.iou ?? 0.5;
  document.getElementById("setup-det-imgsz").value = det.imgsz ?? 960;

  const worker = classes.worker || {};
  const vehicle = classes.vehicle || {};
  const machine = classes.machine || {};
  document.getElementById("setup-w-conf").value = worker.conf ?? 0.28;
  document.getElementById("setup-w-h").value = worker.min_height_frac ?? 0;
  document.getElementById("setup-w-foot").value = worker.min_foot_frac ?? 0;
  document.getElementById("setup-v-conf").value = vehicle.conf ?? 0.24;
  document.getElementById("setup-v-h").value = vehicle.min_height_frac ?? 0;
  document.getElementById("setup-v-foot").value = vehicle.min_foot_frac ?? 0;
  document.getElementById("setup-m-conf").value = machine.conf ?? 0.16;
  document.getElementById("setup-m-h").value = machine.min_height_frac ?? 0;
  document.getElementById("setup-m-foot").value = machine.min_foot_frac ?? 0;

  document.getElementById("setup-trk-backend").value = trk.backend || "bytetrack";
  document.getElementById("setup-trk-iou").value = trk.iou_match ?? trk.match_thresh ?? 0.12;
  document.getElementById("setup-trk-age").value = trk.max_age ?? 28;
  document.getElementById("setup-trk-hits").value = trk.min_hits ?? 2;
  document.getElementById("setup-trk-high").value = trk.high_thresh ?? 0.25;
  document.getElementById("setup-trk-low").value = trk.low_thresh ?? 0.1;
  document.getElementById("setup-trk-second").value = trk.second_match ?? 0.5;

  document.getElementById("setup-risk-horizon").value = risk.horizon_s ?? 5;
  document.getElementById("setup-risk-warn").value = risk.warning_ttc_s ?? 2.5;
  document.getElementById("setup-risk-crit").value = risk.critical_ttc_s ?? 1.2;
  document.getElementById("setup-risk-adv-m").value = risk.advisory_distance_m ?? 4;
  document.getElementById("setup-risk-warn-m").value = risk.warning_distance_m ?? 2;
  document.getElementById("setup-risk-crit-m").value = risk.critical_distance_m ?? 0.5;
  document.getElementById("setup-risk-hold").value = risk.min_hold_s ?? 0.8;
  document.getElementById("setup-risk-cool").value = risk.cooldown_s ?? 5;
  document.getElementById("setup-risk-dwell").value = risk.zone_dwell_s ?? 0;

  const incidents = cfg.incidents || {};
  const heatmap = cfg.heatmap || {};
  document.getElementById("setup-inc-enabled").checked = incidents.enabled !== false;
  document.getElementById("setup-inc-preroll").value = incidents.pre_roll_frames ?? 48;
  document.getElementById("setup-hm-enabled").checked = heatmap.enabled !== false;
  document.getElementById("setup-webhook").value = incidents.webhook_url || "";

  document.getElementById("setup-stream-w").value = stream.max_width ?? 960;
  document.getElementById("setup-stream-q").value = stream.jpeg_quality ?? 78;
  document.getElementById("setup-pii").checked = privacy.blur_faces !== false;

  const yt = cfg.youtube || {};
  document.getElementById("setup-yt-browser").value = yt.cookies_from_browser || "firefox";
  document.getElementById("setup-yt-cookies").value = yt.cookies_file || "";

  const road = document.getElementById("setup-roadmap");
  road.innerHTML = "";
  for (const item of data.roadmap || []) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="road-top"><strong>${item.title}</strong><span class="status ${item.status}">${item.status}</span></div><p>${item.note}</p>`;
    road.appendChild(li);
  }

  const localNote = data.has_local ? "Overrides active (config/local.json)." : "Using defaults.";
  document.getElementById("setup-status").textContent = `${data.gpu || data.device || "GPU"} · ${localNote}`;
  document.getElementById("setup-sub").textContent = data.has_local
    ? "Detector, tracker, risk, and stream. Overrides saved in config/local.json."
    : "Detector, tracker, risk, and stream. Save writes config/local.json.";
}

async function openSetup() {
  const data = await fetch("/api/setup").then((r) => r.json());
  fillSetup(data);
  setupOverlay.hidden = false;
}

function closeSetup() {
  setupOverlay.hidden = true;
}

function collectSetup() {
  return {
    detector: {
      weights: document.getElementById("setup-weights").value,
      conf: num("setup-det-conf"),
      iou: num("setup-det-iou"),
      imgsz: Math.round(num("setup-det-imgsz")),
    },
    classes: {
      worker: {
        conf: num("setup-w-conf"),
        min_height_frac: num("setup-w-h"),
        min_foot_frac: num("setup-w-foot"),
      },
      vehicle: {
        conf: num("setup-v-conf"),
        min_height_frac: num("setup-v-h"),
        min_foot_frac: num("setup-v-foot"),
      },
      machine: {
        conf: num("setup-m-conf"),
        min_height_frac: num("setup-m-h"),
        min_foot_frac: num("setup-m-foot"),
      },
    },
    tracker: {
      backend: document.getElementById("setup-trk-backend").value,
      iou_match: num("setup-trk-iou"),
      match_thresh: num("setup-trk-iou"),
      max_age: Math.round(num("setup-trk-age")),
      min_hits: Math.round(num("setup-trk-hits")),
      high_thresh: num("setup-trk-high"),
      low_thresh: num("setup-trk-low"),
      second_match: num("setup-trk-second"),
    },
    risk: {
      horizon_s: num("setup-risk-horizon"),
      warning_ttc_s: num("setup-risk-warn"),
      critical_ttc_s: num("setup-risk-crit"),
      advisory_distance_m: num("setup-risk-adv-m"),
      warning_distance_m: num("setup-risk-warn-m"),
      critical_distance_m: num("setup-risk-crit-m"),
      min_hold_s: num("setup-risk-hold"),
      cooldown_s: num("setup-risk-cool"),
      zone_dwell_s: num("setup-risk-dwell"),
    },
    incidents: {
      enabled: document.getElementById("setup-inc-enabled").checked,
      pre_roll_frames: Math.round(num("setup-inc-preroll")),
      webhook_url: document.getElementById("setup-webhook").value.trim(),
    },
    heatmap: {
      enabled: document.getElementById("setup-hm-enabled").checked,
    },
    stream: {
      max_width: Math.round(num("setup-stream-w")),
      jpeg_quality: Math.round(num("setup-stream-q")),
    },
    privacy: {
      blur_faces: document.getElementById("setup-pii").checked,
    },
    youtube: {
      cookies_from_browser: document.getElementById("setup-yt-browser").value,
      cookies_file: document.getElementById("setup-yt-cookies").value.trim(),
    },
  };
}

setupBtn.addEventListener("click", () => openSetup());
document.getElementById("setup-close").addEventListener("click", closeSetup);
setupOverlay.addEventListener("click", (e) => {
  if (e.target === setupOverlay) closeSetup();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && setupOverlay && !setupOverlay.hidden) closeSetup();
});

document.getElementById("setup-save").addEventListener("click", async () => {
  const status = document.getElementById("setup-status");
  status.textContent = "Applying…";
  const res = await fetch("/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(collectSetup()),
  });
  const data = await res.json();
  if (!res.ok) {
    status.textContent = data.detail || "Save failed";
    showBanner(typeof data.detail === "string" ? data.detail : "Setup save failed", "critical");
    return;
  }
  fillSetup(data);
  setPiiButton(!!(data.config?.privacy?.blur_faces !== false));
  toast("Setup applied", "clear");
});

document.getElementById("setup-reset").addEventListener("click", async () => {
  const res = await fetch("/api/setup/reset", { method: "POST" });
  const data = await res.json();
  if (!res.ok) {
    toast(data.detail || "Reset failed", "critical");
    return;
  }
  fillSetup(data);
  setPiiButton(!!(data.config?.privacy?.blur_faces !== false));
  toast("Defaults restored", "clear");
});

document.getElementById("btn-incidents")?.addEventListener("click", () => openIncidentDrawer(true));
document.getElementById("drawer-close")?.addEventListener("click", () => openIncidentDrawer(false));
document.getElementById("drawer-backdrop")?.addEventListener("click", () => openIncidentDrawer(false));
document.getElementById("preview-close")?.addEventListener("click", closeIncidentPreview);
document.getElementById("incident-preview")?.addEventListener("click", (e) => {
  if (e.target.id === "incident-preview") closeIncidentPreview();
});

soundBtn?.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem("yardline_sound", soundEnabled ? "1" : "0");
  soundBtn.classList.toggle("active", soundEnabled);
  toast(soundEnabled ? "Alert sound on" : "Alert sound muted", "advisory");
});

function hideCoach() {
  coachHidden = true;
  localStorage.setItem("yardline_coach", "0");
  const el = document.getElementById("coach");
  if (el) el.hidden = true;
}
document.getElementById("coach-close")?.addEventListener("click", hideCoach);
document.getElementById("btn-dismiss-coach")?.addEventListener("click", () => {
  hideCoach();
  document.getElementById("tools-pop")?.removeAttribute("open");
  document.querySelector("body > .tools-menu")?.classList.remove("is-open");
});

document.getElementById("zone-inspector")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedZoneId) return;
  const next = zones.map((z) => {
    if (z.id !== selectedZoneId) return z;
    return {
      ...z,
      name: document.getElementById("zi-name").value.trim() || z.name,
      kind: document.getElementById("zi-kind").value,
      level: parseInt(document.getElementById("zi-level").value, 10),
      dwell_s: parseFloat(document.getElementById("zi-dwell").value) || 0,
    };
  });
  await persistZones(next);
  toast("Zone updated", "clear");
});

document.getElementById("zi-delete")?.addEventListener("click", async () => {
  if (!selectedZoneId) return;
  const id = selectedZoneId;
  selectedZoneId = null;
  await persistZones(zones.filter((z) => z.id !== id));
  toast("Zone deleted", "advisory");
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!document.getElementById("incident-preview")?.hidden) {
    closeIncidentPreview();
    return;
  }
  if (!document.getElementById("incident-drawer")?.hidden) {
    openIncidentDrawer(false);
    return;
  }
  if (setupOverlay && !setupOverlay.hidden) closeSetup();
});

document.getElementById("preset-select")?.addEventListener("change", async () => {
  const id = document.getElementById("preset-select").value;
  const preset = cameraPresets.find((p) => p.id === id);
  if (!preset) return;
  document.getElementById("live-url").value = preset.source;
  if (preset.site_id) {
    const sel = document.getElementById("site-select");
    if (sel) sel.value = preset.site_id;
  }
  toast(`Preset “${preset.name}” loaded — Open live`, "advisory");
});

function saveSession() {
  const slot = camSlots[activeCamSlot] || camSlots[0];
  slot.path = sourceEl.value || slot.path;
  slot.liveUrl = document.getElementById("live-url").value.trim();
  localStorage.setItem("yardline_cam_slots", JSON.stringify(camSlots));
  localStorage.setItem("yardline_cam_slot", String(activeCamSlot));
  localStorage.setItem(
    "yardline_session",
    JSON.stringify({
      path: sourceEl.value,
      liveUrl: document.getElementById("live-url").value.trim(),
      playing,
      speed: speedEl.value,
      heatmap: showHeatmap,
      severity: severityMin,
      heatmapWindow: document.getElementById("heatmap-window")?.value || "120",
    })
  );
}

function renderCamTabs() {
  document.querySelectorAll(".cam-tab").forEach((btn) => {
    const slot = parseInt(btn.dataset.slot, 10);
    btn.classList.toggle("active", slot === activeCamSlot);
    const info = camSlots[slot];
    if (info?.path || info?.liveUrl) {
      const name = (info.liveUrl || info.path || "").split("/").pop().slice(0, 18);
      btn.textContent = name || `Cam ${slot + 1}`;
    } else {
      btn.textContent = `Cam ${slot + 1}`;
    }
  });
}

async function switchCamSlot(slot) {
  saveSession();
  activeCamSlot = slot;
  localStorage.setItem("yardline_cam_slot", String(slot));
  renderCamTabs();
  const info = camSlots[slot] || {};
  if (info.liveUrl) document.getElementById("live-url").value = info.liveUrl;
  if (info.path && [...sourceEl.options].some((o) => o.value === info.path)) {
    sourceEl.value = info.path;
    syncClipLabel();
  }
  const target = info.liveUrl || info.path || sourceEl.value;
  if (!target) {
    toast(`Cam ${slot + 1} empty — set a clip or live URL`, "advisory");
    return;
  }
  send({ action: "open", path: target });
  toast(`Switched to Cam ${slot + 1}`, "advisory");
}

async function restoreSession() {
  if (sessionRestored) return;
  sessionRestored = true;
  const sev = document.getElementById("severity-filter");
  if (sev) sev.value = String(severityMin);
  const hm = document.getElementById("heatmap-window");
  let session = null;
  try {
    session = JSON.parse(localStorage.getItem("yardline_session") || "null");
  } catch {
    session = null;
  }
  if (hm && session?.heatmapWindow != null) hm.value = String(session.heatmapWindow);
  if (hm) {
    await fetch("/api/heatmap/window", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ window_s: parseFloat(hm.value) }),
    }).catch(() => {});
  }
  renderCamTabs();
  const slot = camSlots[activeCamSlot] || {};
  const path = slot.liveUrl || slot.path || session?.liveUrl || session?.path;
  if (path) {
    if (slot.liveUrl || (session?.liveUrl && path === session.liveUrl)) {
      document.getElementById("live-url").value = path;
    } else if ([...sourceEl.options].some((o) => o.value === path)) {
      sourceEl.value = path;
      syncClipLabel();
    }
    send({ action: "open", path });
    if (session?.playing !== false) {
      // live autoplays; clips wait for user or play after open
      window.setTimeout(() => {
        if (!playing) {
          send({ action: "play" });
          playing = true;
          playBtn.textContent = "Pause";
        }
      }, 800);
    }
  }
}

async function suggestStreamPreset(sourcePath) {
  try {
    const data = await fetch(`/api/stream-presets?source=${encodeURIComponent(sourcePath || "")}`).then((r) => r.json());
    const s = data.suggested;
    if (!s || sourceMeta?.calibrated) return;
    if (s.cal_preset && calPreset) calPreset.value = s.cal_preset;
    if (s.width_m) calWidth.value = String(s.width_m);
    if (s.depth_m) calDepth.value = String(s.depth_m);
    toast(`Suggested plane: ${s.name} (${s.width_m}×${s.depth_m} m)`, "advisory");
  } catch {
    /* ignore */
  }
}

async function downloadReport(fmt = "csv") {
  if (fmt === "csv") {
    const text = await fetch("/api/report?fmt=csv").then((r) => r.text());
    const blob = new Blob([text], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `yardline-shift-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Shift CSV downloaded", "clear");
    return;
  }
  const data = await fetch("/api/report?fmt=save").then((r) => r.json());
  toast(`Report saved ${data.path || ""}`, "clear");
}

document.getElementById("severity-filter")?.addEventListener("change", (e) => {
  severityMin = parseInt(e.target.value, 10) || 0;
  localStorage.setItem("yardline_severity", String(severityMin));
  toast(`Alerts ≥ ${["all", "advisory", "warning", "critical"][severityMin] || severityMin}`, "advisory");
  saveSession();
});

document.getElementById("heatmap-window")?.addEventListener("change", async (e) => {
  const window_s = parseFloat(e.target.value);
  await fetch("/api/heatmap/window", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ window_s }),
  });
  toast(window_s > 0 ? `Heatmap window ${window_s}s` : "Heatmap live EWMA", "advisory");
  saveSession();
});

document.getElementById("btn-heatmap-clear")?.addEventListener("click", async () => {
  await fetch("/api/heatmap/clear", { method: "POST" });
  toast("Heatmap cleared", "advisory");
});

document.getElementById("btn-report")?.addEventListener("click", () => downloadReport("csv"));
document.getElementById("btn-report-drawer")?.addEventListener("click", () => downloadReport("csv"));

document.getElementById("site-select")?.addEventListener("change", async () => {
  const site_id = document.getElementById("site-select").value || null;
  const res = await fetch("/api/sites/active", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site_id }),
  });
  const data = await res.json();
  if (!res.ok) {
    toast(data.detail || "Could not set site", "warning");
    return;
  }
  activeSiteId = site_id || "";
  localStorage.setItem("yardline_site_id", activeSiteId);
  updateSiteKpiPills(data.active_site);
  toast(data.active_site ? `Site “${data.active_site.name}”` : "No active site", "advisory");
});

document.getElementById("btn-bind-cam")?.addEventListener("click", async () => {
  const site_id = document.getElementById("site-select")?.value || activeSiteId;
  if (!site_id) {
    toast("Select a site first", "advisory");
    return;
  }
  const source =
    document.getElementById("live-url").value.trim() ||
    sourceEl.value ||
    sourceMeta?.path ||
    "";
  if (!source) {
    toast("Open a live URL or clip first", "advisory");
    return;
  }
  const camera_id = `cam${activeCamSlot + 1}`;
  const label = window.prompt("Camera label", camSlots[activeCamSlot]?.label || `Cam ${activeCamSlot + 1}`) || "";
  if (!label.trim()) return;
  const offsetRaw = window.prompt("Site offset meters as x,y (shared ground)", "0,0") || "0,0";
  const parts = offsetRaw.split(",").map((x) => parseFloat(x.trim()));
  const offset_m = [Number.isFinite(parts[0]) ? parts[0] : 0, Number.isFinite(parts[1]) ? parts[1] : 0];
  const res = await fetch(`/api/sites/${encodeURIComponent(site_id)}/cameras`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      camera_id,
      label: label.trim(),
      source,
      offset_m,
      note: "",
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    toast(data.detail || "Bind failed", "warning");
    return;
  }
  camSlots[activeCamSlot] = {
    ...(camSlots[activeCamSlot] || {}),
    label: label.trim(),
    path: sourceEl.value || "",
    liveUrl: document.getElementById("live-url").value.trim(),
    site_id,
    camera_id,
    offset_m,
  };
  localStorage.setItem("yardline_cam_slots", JSON.stringify(camSlots));
  await loadSites();
  toast(`Bound ${label.trim()} → ${site_id}`, "clear");
});

document.getElementById("btn-geo-save")?.addEventListener("click", () => saveGeoFromInputs());

document.getElementById("btn-geo-pick")?.addEventListener("click", () => openGeoPicker());
document.getElementById("btn-geo-pick-dock")?.addEventListener("click", () => openGeoPicker());
document.getElementById("geo-close")?.addEventListener("click", () => closeGeoPicker());
document.getElementById("geo-apply")?.addEventListener("click", () => applyGeoPicker());
document.getElementById("geo-search-btn")?.addEventListener("click", () => runGeoSearch());
document.getElementById("geo-search")?.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    runGeoSearch();
  }
});
document.getElementById("geo-paste")?.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    const parsed = parseLatLon(text);
    if (!parsed) {
      toast("Clipboard needs lat,lon", "advisory");
      return;
    }
    setGeoDraft(parsed.lat, parsed.lon, geoDraft.bearing);
    toast("Pasted coordinates", "clear");
  } catch {
    const text = window.prompt("Paste lat,lon", "") || "";
    const parsed = parseLatLon(text);
    if (!parsed) {
      toast("Could not parse lat,lon", "warning");
      return;
    }
    setGeoDraft(parsed.lat, parsed.lon, geoDraft.bearing);
  }
});
document.getElementById("geo-here")?.addEventListener("click", () => {
  if (!navigator.geolocation) {
    toast("Geolocation unavailable", "warning");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setGeoDraft(pos.coords.latitude, pos.coords.longitude, geoDraft.bearing);
      toast("Used device location", "clear");
    },
    () => toast("Location permission denied", "warning"),
    { enableHighAccuracy: true, timeout: 8000 }
  );
});
document.getElementById("geo-site")?.addEventListener("click", () => {
  const site = sites.find((s) => s.id === activeSiteId);
  const o = site?.origin_geo;
  if (!o) {
    toast("Active site has no saved geo yet", "advisory");
    return;
  }
  setGeoDraft(o.lat, o.lon, o.bearing_deg ?? 0);
  toast("Loaded site origin", "clear");
});

async function saveGeoFromInputs() {
  const lat = parseFloat(document.getElementById("geo-lat")?.value);
  const lon = parseFloat(document.getElementById("geo-lon")?.value);
  const bearing_deg = parseFloat(document.getElementById("geo-bearing")?.value || "0");
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    openGeoPicker();
    toast("Pick geo on the map", "advisory");
    return;
  }
  const ok = await persistGeoAnchor(lat, lon, bearing_deg);
  if (ok) toast("Geo origin saved for GIS export", "clear");
}

async function persistGeoAnchor(lat, lon, bearing_deg = 0) {
  if (!activeSiteId) {
    toast("Select a site first", "advisory");
    return false;
  }
  const res = await fetch("/api/geo/anchor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lat,
      lon,
      bearing_deg,
      site_id: activeSiteId || null,
      apply_to_site: true,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    toast(data.detail || "Geo save failed", "warning");
    return false;
  }
  fillGeoInputs(lat, lon, bearing_deg);
  await loadSites();
  return true;
}

function fillGeoInputs(lat, lon, bearing = 0) {
  const latEl = document.getElementById("geo-lat");
  const lonEl = document.getElementById("geo-lon");
  const bearingEl = document.getElementById("geo-bearing");
  if (latEl) latEl.value = Number(lat).toFixed(6);
  if (lonEl) lonEl.value = Number(lon).toFixed(6);
  if (bearingEl) bearingEl.value = String(Number(bearing) || 0);
}

function parseLatLon(text) {
  const m = String(text || "").trim().match(/(-?\d+\.?\d*)\s*[,;\s]\s*(-?\d+\.?\d*)/);
  if (!m) return null;
  const a = parseFloat(m[1]);
  const b = parseFloat(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // Heuristic: |lat|<=90, if first looks like lon and second lat, swap.
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lon: b };
  if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return { lat: b, lon: a };
  return null;
}

let geoMap = null;
let geoMarker = null;
let geoLine = None;
let geoDraft = { lat: null, lon: null, bearing: 0, step: 0 };
const geoOverlay = document.getElementById("geo-overlay");

function openGeoPicker() {
  if (!geoOverlay) return;
  geoOverlay.hidden = false;
  const site = sites.find((s) => s.id === activeSiteId);
  const o = site?.origin_geo || lastFrame?.geo_anchor;
  if (o) {
    geoDraft = { lat: o.lat, lon: o.lon, bearing: o.bearing_deg || 0, step: 0 };
    fillGeoInputs(o.lat, o.lon, o.bearing_deg || 0);
  } else {
    geoDraft = { lat: 37.7749, lon: -122.4194, bearing: 0, step: 0 };
  }
  window.setTimeout(() => {
    ensureGeoMap();
    setGeoDraft(geoDraft.lat, geoDraft.lon, geoDraft.bearing);
  }, 40);
}

function closeGeoPicker() {
  if (geoOverlay) geoOverlay.hidden = true;
}

function ensureGeoMap() {
  if (typeof L === "undefined") {
    toast("Map library failed to load", "warning");
    return;
  }
  if (geoMap) {
    geoMap.invalidateSize();
    return;
  }
  geoMap = L.map("geo-map", { zoomControl: true }).setView([geoDraft.lat || 0, geoDraft.lon || 0], 17);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(geoMap);
  geoMap.on("click", (ev) => {
    if (geoDraft.step === 0 || geoDraft.lat == null) {
      setGeoDraft(ev.latlng.lat, ev.latlng.lng, geoDraft.bearing);
      geoDraft.step = 1;
      updateGeoReadout("Origin set — click along +Y (depth) for bearing");
    } else {
      const bearing = bearingBetween(geoDraft.lat, geoDraft.lon, ev.latlng.lat, ev.latlng.lng);
      setGeoDraft(geoDraft.lat, geoDraft.lon, bearing, ev.latlng);
      geoDraft.step = 0;
      updateGeoReadout(`Bearing ${bearing.toFixed(1)}° — Save & use`);
    }
  });
}

function bearingBetween(lat1, lon1, lat2, lon2) {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function setGeoDraft(lat, lon, bearing = 0, along = null) {
  geoDraft.lat = lat;
  geoDraft.lon = lon;
  geoDraft.bearing = bearing;
  fillGeoInputs(lat, lon, bearing);
  if (!geoMap) return;
  const ll = [lat, lon];
  if (!geoMarker) geoMarker = L.marker(ll).addTo(geoMap);
  else geoMarker.setLatLng(ll);
  if (geoLine) {
    geoMap.removeLayer(geoLine);
    geoLine = null;
  }
  if (along) {
    geoLine = L.polyline([ll, [along.lat, along.lng]], { color: "#c4a574", weight: 3 }).addTo(geoMap);
  } else if (Number.isFinite(bearing)) {
    const dest = destinationPoint(lat, lon, bearing, 40);
    geoLine = L.polyline([ll, dest], { color: "#8ec3d4", weight: 2, dashArray: "6 4" }).addTo(geoMap);
  }
  geoMap.setView(ll, Math.max(geoMap.getZoom(), 17));
  updateGeoReadout(`Origin ${lat.toFixed(5)}, ${lon.toFixed(5)} · bearing ${Number(bearing).toFixed(1)}°`);
}

function destinationPoint(lat, lon, bearingDeg, distM) {
  const R = 6371000;
  const δ = distM / R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );
  return [(φ2 * 180) / Math.PI, (λ2 * 180) / Math.PI];
}

function updateGeoReadout(text) {
  const el = document.getElementById("geo-readout");
  if (el) el.textContent = text;
}

async function runGeoSearch() {
  const q = document.getElementById("geo-search")?.value.trim();
  if (!q) return;
  const res = await fetch(`/api/geo/search?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  const list = document.getElementById("geo-hits");
  if (!res.ok) {
    toast(data.detail || "Search failed", "warning");
    return;
  }
  const hits = data.hits || [];
  if (!list) return;
  if (!hits.length) {
    list.hidden = true;
    list.innerHTML = "";
    toast("No places found", "advisory");
    return;
  }
  list.hidden = false;
  list.innerHTML = hits
    .map(
      (h, i) =>
        `<li><button type="button" data-i="${i}">${h.label}</button></li>`
    )
    .join("");
  list.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const hit = hits[Number(btn.dataset.i)];
      setGeoDraft(hit.lat, hit.lon, geoDraft.bearing);
      geoDraft.step = 1;
      list.hidden = true;
      updateGeoReadout("Origin from search — click map along +Y for bearing");
    });
  });
}

async function applyGeoPicker() {
  if (!Number.isFinite(geoDraft.lat) || !Number.isFinite(geoDraft.lon)) {
    toast("Click the map to set origin", "advisory");
    return;
  }
  const ok = await persistGeoAnchor(geoDraft.lat, geoDraft.lon, geoDraft.bearing || 0);
  if (ok) {
    closeGeoPicker();
    toast("Site geo saved — GIS is ready", "clear");
  }
}

document.getElementById("btn-gis")?.addEventListener("click", async () => {
  const site = sites.find((s) => s.id === activeSiteId);
  if (!site?.origin_geo) {
    openGeoPicker();
    toast("Set site geo first", "advisory");
    return;
  }
  const res = await fetch(`/api/gis/export?save=true${activeSiteId ? `&site_id=${encodeURIComponent(activeSiteId)}` : ""}`);
  const data = await res.json();
  if (!res.ok) {
    toast(data.detail || "GIS export failed", "warning");
    return;
  }
  const blob = new Blob([JSON.stringify(data.geojson, null, 2)], { type: "application/geo+json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `site-${activeSiteId || "export"}-${Date.now()}.geojson`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(data.saved ? `GeoJSON saved ${data.saved}` : "GeoJSON downloaded", "clear");
});

document.getElementById("btn-save-preset")?.addEventListener("click", async () => {
  const source = document.getElementById("live-url").value.trim();
  if (!source) {
    toast("Enter a live URL first", "advisory");
    return;
  }
  const name = window.prompt("Preset name", source.slice(0, 40)) || "";
  if (!name.trim()) return;
  const res = await fetch("/api/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: name.trim(),
      source,
      note: "",
      site_id: activeSiteId || null,
      camera_id: camSlots[activeCamSlot]?.camera_id || `cam${activeCamSlot + 1}`,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    toast(data.detail || "Could not save preset", "critical");
    return;
  }
  cameraPresets = data.presets || [];
  await loadPresets();
  if (data.preset?.id) document.getElementById("preset-select").value = data.preset.id;
  toast(`Saved preset “${name.trim()}”`, "clear");
});

document.querySelectorAll(".cam-tab").forEach((btn) => {
  btn.addEventListener("click", () => switchCamSlot(parseInt(btn.dataset.slot, 10)));
});

window.setInterval(saveSession, 5000);

boot().then(() => {
  window.setTimeout(() => restoreSession(), 500);
});
