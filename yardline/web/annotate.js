const canvas = document.getElementById("anno");
const ctx = canvas.getContext("2d");
const wrap = document.getElementById("anno-wrap");
const sampleList = document.getElementById("sample-list");
const banner = document.getElementById("banner");

const COLORS = {
  person: "#8ec3d4",
  vehicle: "#d4c07a",
  robot: "#e0a05a",
};

let samples = [];
let current = null;
let boxes = [];
let activeClass = "person";
let selected = -1;
let drawing = null;
let img = null;
let trainTimer = 0;

function showBanner(text, kind = "") {
  if (!banner) return;
  banner.hidden = !text;
  banner.textContent = text || "";
  banner.className = "banner" + (kind ? ` ${kind}` : "");
}

function fitCanvas() {
  const r = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(r.width * dpr));
  const h = Math.max(1, Math.floor(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function viewTransform() {
  if (!img) return { scale: 1, ox: 0, oy: 0 };
  const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
  const ox = (canvas.width - img.width * scale) / 2;
  const oy = (canvas.height - img.height * scale) / 2;
  return { scale, ox, oy };
}

function toImage(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) * canvas.width) / rect.width;
  const y = ((clientY - rect.top) * canvas.height) / rect.height;
  const { scale, ox, oy } = viewTransform();
  return {
    x: (x - ox) / scale,
    y: (y - oy) / scale,
  };
}

function draw() {
  fitCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0d0c0b";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!img) {
    ctx.fillStyle = "#9c968b";
    ctx.font = "14px Outfit, sans-serif";
    ctx.fillText("Capture a still from the live page, or pick one in the rail.", 24, 40);
    return;
  }
  const { scale, ox, oy } = viewTransform();
  ctx.drawImage(img, ox, oy, img.width * scale, img.height * scale);

  const all = drawing ? boxes.concat([drawing]) : boxes;
  all.forEach((b, i) => {
    const [x1, y1, x2, y2] = b.bbox;
    const color = COLORS[b.class_name] || "#c4a574";
    ctx.strokeStyle = color;
    ctx.lineWidth = i === selected ? 3 : 2;
    ctx.strokeRect(ox + x1 * scale, oy + y1 * scale, (x2 - x1) * scale, (y2 - y1) * scale);
    ctx.fillStyle = color;
    ctx.font = "12px Outfit, sans-serif";
    ctx.fillText(b.class_name, ox + x1 * scale + 4, oy + y1 * scale - 6);
  });
}

function setStats(stats) {
  if (!stats) return;
  document.getElementById("stat-samples").textContent = `${stats.n_samples} stills`;
  document.getElementById("stat-labeled").textContent = `${stats.n_labeled} labeled`;
  document.getElementById("stat-boxes").textContent = `${stats.n_boxes} boxes`;
}

function renderList() {
  sampleList.innerHTML = samples.length
    ? samples
        .map(
          (s) => `<button type="button" class="sample-item${current && current.id === s.id ? " active" : ""}" data-id="${s.id}">
            <img src="${s.image_url}" alt="" />
            <span>${s.id.slice(0, 18)}… · ${s.n_boxes} box</span>
          </button>`
        )
        .join("")
    : `<p class="fine">No stills yet. Play live, then Capture.</p>`;
  sampleList.querySelectorAll(".sample-item").forEach((btn) => {
    btn.addEventListener("click", () => loadSample(btn.dataset.id));
  });
}

async function refreshList() {
  const [stats, list] = await Promise.all([
    fetch("/api/dataset").then((r) => r.json()),
    fetch("/api/dataset/samples").then((r) => r.json()),
  ]);
  setStats(stats);
  samples = list;
  renderList();
}

async function loadSample(id) {
  const data = await fetch(`/api/dataset/samples/${id}`).then((r) => r.json());
  current = data;
  boxes = (data.boxes || []).map((b) => ({ ...b, bbox: b.bbox.slice() }));
  selected = -1;
  document.getElementById("canvas-meta").textContent = `${data.id} · ${data.width}×${data.height}`;
  img = new Image();
  img.onload = () => draw();
  img.src = data.image_url + `?t=${Date.now()}`;
  renderList();
}

async function capture() {
  const res = await fetch("/api/dataset/capture?seed=true", { method: "POST" });
  const data = await res.json();
  if (!res.ok) {
    showBanner(data.detail || "Capture failed — open Live and play a source first.", "critical");
    return;
  }
  setStats(data.stats);
  showBanner(`Captured ${data.sample.id}`, "clear");
  await refreshList();
  await loadSample(data.sample.id);
}

async function saveLabels() {
  if (!current) return;
  const res = await fetch(`/api/dataset/samples/${current.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ boxes }),
  });
  const data = await res.json();
  if (!res.ok) {
    showBanner(data.detail || "Save failed", "critical");
    return;
  }
  current = data.sample;
  boxes = data.sample.boxes || [];
  setStats(data.stats);
  showBanner("Labels saved.", "clear");
  await refreshList();
  draw();
}

async function groundSample() {
  if (!current) {
    showBanner("Select or capture a still first.", "warning");
    return;
  }
  showBanner("Grounding with YOLO-World…");
  const res = await fetch(`/api/dataset/samples/${current.id}/ground`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompts: document.getElementById("ground-prompts").value,
      conf: parseFloat(document.getElementById("ground-conf").value),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    showBanner(data.detail || "Ground failed", "critical");
    return;
  }
  current = data.sample;
  boxes = data.sample.boxes || [];
  setStats(data.stats);
  showBanner(`Grounded ${boxes.length} boxes — edit then Save.`, "clear");
  await refreshList();
  draw();
}

async function exportCoco() {
  const res = await fetch("/api/dataset/export/coco", { method: "POST" });
  const data = await res.json();
  if (!res.ok) {
    showBanner(data.detail || "COCO export failed", "critical");
    return;
  }
  setStats(data.stats);
  showBanner(`Exported COCO: ${data.n_images} images, ${data.n_annotations} boxes.`, "clear");
}

async function deleteSample() {
  if (!current) return;
  const id = current.id;
  await fetch(`/api/dataset/samples/${id}`, { method: "DELETE" });
  current = null;
  boxes = [];
  img = null;
  document.getElementById("canvas-meta").textContent = "Capture a still from the live page.";
  await refreshList();
  draw();
  showBanner(`Deleted ${id}`, "clear");
}

function hitTest(pt) {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const [x1, y1, x2, y2] = boxes[i].bbox;
    if (pt.x >= x1 && pt.x <= x2 && pt.y >= y1 && pt.y <= y2) return i;
  }
  return -1;
}

canvas.addEventListener("mousedown", (e) => {
  if (!img) return;
  const pt = toImage(e.clientX, e.clientY);
  const hit = hitTest(pt);
  if (hit >= 0) {
    selected = hit;
    drawing = null;
    draw();
    return;
  }
  selected = -1;
  drawing = { class_name: activeClass, bbox: [pt.x, pt.y, pt.x, pt.y], conf: 1 };
  draw();
});

canvas.addEventListener("mousemove", (e) => {
  if (!drawing) return;
  const pt = toImage(e.clientX, e.clientY);
  drawing.bbox[2] = pt.x;
  drawing.bbox[3] = pt.y;
  draw();
});

function finishDraw() {
  if (!drawing) return;
  let [x1, y1, x2, y2] = drawing.bbox;
  if (Math.abs(x2 - x1) > 4 && Math.abs(y2 - y1) > 4) {
    boxes.push({
      class_name: drawing.class_name,
      bbox: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)],
      conf: 1,
    });
    selected = boxes.length - 1;
  }
  drawing = null;
  draw();
}

canvas.addEventListener("mouseup", finishDraw);
canvas.addEventListener("mouseleave", finishDraw);

window.addEventListener("keydown", (e) => {
  if (e.key === "Delete" || e.key === "Backspace") {
    if (selected >= 0) {
      boxes.splice(selected, 1);
      selected = -1;
      draw();
    }
  }
  if (e.key === "1") setClass("person");
  if (e.key === "2") setClass("vehicle");
  if (e.key === "3") setClass("robot");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveLabels();
  }
});

function setClass(name) {
  activeClass = name;
  document.querySelectorAll(".class-picks button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.cls === name);
  });
}

document.querySelectorAll(".class-picks button").forEach((btn) => {
  btn.addEventListener("click", () => setClass(btn.dataset.cls));
});

document.getElementById("btn-capture").addEventListener("click", capture);
document.getElementById("btn-save").addEventListener("click", saveLabels);
document.getElementById("btn-ground").addEventListener("click", groundSample);
document.getElementById("btn-export-coco").addEventListener("click", exportCoco);
document.getElementById("btn-delete").addEventListener("click", deleteSample);

async function pollTrain() {
  const job = await fetch("/api/dataset/train").then((r) => r.json());
  const pill = document.getElementById("train-pill");
  const log = document.getElementById("train-log");
  const meta = document.getElementById("train-meta");
  if (job.running) {
    pill.textContent = "Train running";
    pill.className = "pill warn";
  } else if (job.status === "done") {
    pill.textContent = "Train done";
    pill.className = "pill ok";
  } else if (job.status === "failed" || job.status === "stopped") {
    pill.textContent = `Train ${job.status}`;
    pill.className = "pill crit";
  } else {
    pill.textContent = "Train idle";
    pill.className = "pill muted";
  }
  log.textContent = job.log_tail || (job.id ? `Job ${job.id}` : "No job yet.");
  if (job.latest_weights) {
    meta.textContent = `Latest weights: ${job.latest_weights}. Use Promote to live to copy into weights/site_best.pt and hot-reload.`;
  } else if (job.backend && String(job.backend).startsWith("tao")) {
    meta.textContent = `${job.backend} · results under data/tao/results. First pull may take a while (nvcr.io).`;
  }
}

document.getElementById("btn-promote")?.addEventListener("click", async () => {
  const res = await fetch("/api/dataset/promote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apply: true }),
  });
  const data = await res.json();
  if (!res.ok) {
    showBanner(data.detail || "Promote failed", "critical");
    return;
  }
  showBanner(`Promoted ${data.weights} and applied to live detector`, "clear");
  pollTrain();
});

document.getElementById("btn-train").addEventListener("click", async () => {
  const res = await fetch("/api/dataset/train", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      backend: document.getElementById("train-backend").value,
      epochs: parseInt(document.getElementById("train-epochs").value, 10),
      imgsz: parseInt(document.getElementById("train-imgsz").value, 10),
      batch: parseInt(document.getElementById("train-batch").value, 10),
      model: document.getElementById("train-model").value.trim(),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    showBanner(data.detail || "Train failed to start", "critical");
    return;
  }
  showBanner(`Training ${data.job.id} (${data.job.backend || "ultralytics"}) started`, "clear");
  pollTrain();
});

document.getElementById("btn-train-stop").addEventListener("click", async () => {
  await fetch("/api/dataset/train/stop", { method: "POST" });
  pollTrain();
});

window.addEventListener("resize", draw);
refreshList();
pollTrain();
trainTimer = setInterval(pollTrain, 4000);
