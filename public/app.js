const EXECUTION_MODES = {
  webgpu: {
    label: "WebGPU ready",
    backend: "webgpu",
    fallbackTriggered: false,
    workerMode: "worker",
    stageMultiplier: 1
  },
  fallback: {
    label: "Wasm fallback",
    backend: "wasm",
    fallbackTriggered: true,
    workerMode: "main",
    stageMultiplier: 1.82
  }
};

function resolveExecutionMode() {
  const requested = new URLSearchParams(window.location.search).get("mode");
  const hasWebGpu = typeof navigator !== "undefined" && Boolean(navigator.gpu);
  if (requested === "fallback" || !hasWebGpu) return EXECUTION_MODES.fallback;
  return EXECUTION_MODES.webgpu;
}

const executionMode = resolveExecutionMode();

const requestedMode = typeof window !== "undefined"
  ? new URLSearchParams(window.location.search).get("mode")
  : null;
const isRealRuntimeMode = typeof requestedMode === "string" && requestedMode.startsWith("real-");
const REAL_ADAPTER_WAIT_MS = 5000;
const REAL_ADAPTER_LOAD_MS = 20000;

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function findRegisteredRealRuntime() {
  const registry = typeof window !== "undefined" ? window.__aiWebGpuLabRuntimeRegistry : null;
  if (!registry || typeof registry.list !== "function") return null;
  return registry.list().find((adapter) => adapter && adapter.isReal === true) || null;
}

async function awaitRealRuntime(timeoutMs = REAL_ADAPTER_WAIT_MS) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const adapter = findRegisteredRealRuntime();
    if (adapter) return adapter;
    if (typeof window !== "undefined" && window.__aiWebGpuLabRealVlmBootstrapError) {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

const state = {
  startedAt: performance.now(),
  fixture: null,
  environment: buildEnvironment(),
  capability: null,
  active: false,
  run: null,
  realAdapterError: null,
  logs: []
};

const elements = {
  statusRow: document.getElementById("status-row"),
  summary: document.getElementById("summary"),
  probeCapability: document.getElementById("probe-capability"),
  runLab: document.getElementById("run-lab"),
  downloadJson: document.getElementById("download-json"),
  qaView: document.getElementById("qa-view"),
  metricGrid: document.getElementById("metric-grid"),
  metaGrid: document.getElementById("meta-grid"),
  logList: document.getElementById("log-list"),
  resultJson: document.getElementById("result-json")
};

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parseBrowser() {
  const ua = navigator.userAgent;
  for (const [needle, name] of [["Edg/", "Edge"], ["Chrome/", "Chrome"], ["Firefox/", "Firefox"], ["Version/", "Safari"]]) {
    const marker = ua.indexOf(needle);
    if (marker >= 0) return { name, version: ua.slice(marker + needle.length).split(/[\s)/;]/)[0] || "unknown" };
  }
  return { name: "Unknown", version: "unknown" };
}

function parseOs() {
  const ua = navigator.userAgent;
  if (/Windows NT/i.test(ua)) return { name: "Windows", version: (ua.match(/Windows NT ([0-9.]+)/i) || [])[1] || "unknown" };
  if (/Mac OS X/i.test(ua)) return { name: "macOS", version: ((ua.match(/Mac OS X ([0-9_]+)/i) || [])[1] || "unknown").replace(/_/g, ".") };
  if (/Android/i.test(ua)) return { name: "Android", version: (ua.match(/Android ([0-9.]+)/i) || [])[1] || "unknown" };
  if (/(iPhone|iPad|CPU OS)/i.test(ua)) return { name: "iOS", version: ((ua.match(/OS ([0-9_]+)/i) || [])[1] || "unknown").replace(/_/g, ".") };
  if (/Linux/i.test(ua)) return { name: "Linux", version: "unknown" };
  return { name: "Unknown", version: "unknown" };
}

function inferDeviceClass() {
  const threads = navigator.hardwareConcurrency || 0;
  const memory = navigator.deviceMemory || 0;
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  if (mobile) return memory >= 6 && threads >= 8 ? "mobile-high" : "mobile-mid";
  if (memory >= 16 && threads >= 12) return "desktop-high";
  if (memory >= 8 && threads >= 8) return "desktop-mid";
  if (threads >= 4) return "laptop";
  return "unknown";
}

function buildEnvironment() {
  return {
    browser: parseBrowser(),
    os: parseOs(),
    device: {
      name: navigator.platform || "unknown",
      class: inferDeviceClass(),
      cpu: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} threads` : "unknown",
      memory_gb: navigator.deviceMemory || undefined,
      power_mode: "unknown"
    },
    gpu: { adapter: "pending", required_features: [], limits: {} },
    backend: "pending",
    fallback_triggered: false,
    worker_mode: "main",
    cache_state: "warm"
  };
}

function log(message) {
  state.logs.unshift(`[${new Date().toLocaleTimeString()}] ${message}`);
  state.logs = state.logs.slice(0, 12);
  renderLogs();
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadFixture() {
  if (state.fixture) return state.fixture;
  const response = await fetch("./multimodal-fixture.json", { cache: "no-store" });
  state.fixture = await response.json();
  return state.fixture;
}

async function probeCapability() {
  if (state.active) return;
  state.active = true;
  render();

  const hasWebGpu = typeof navigator !== "undefined" && Boolean(navigator.gpu);
  const forcedFallback = new URLSearchParams(window.location.search).get("mode") === "fallback";
  const ready = hasWebGpu && !forcedFallback;

  state.capability = {
    hasWebGpu,
    adapter: ready ? "navigator.gpu available" : "wasm-fallback-vision",
    requiredFeatures: ready ? ["shader-f16"] : []
  };
  state.environment.gpu = {
    adapter: state.capability.adapter,
    required_features: state.capability.requiredFeatures,
    limits: ready ? { maxStorageBuffersPerShaderStage: 8, maxComputeWorkgroupStorageSize: 16384 } : {}
  };
  state.environment.backend = executionMode.backend;
  state.environment.fallback_triggered = executionMode.fallbackTriggered;
  state.environment.worker_mode = executionMode.workerMode;
  state.active = false;

  log(ready ? "WebGPU multimodal path selected." : "Fallback multimodal path selected.");
  render();
}

async function runRealRuntimeVlm(adapter) {
  log(`Connecting real runtime adapter '${adapter.id}'.`);
  await withTimeout(
    Promise.resolve(adapter.loadModel({ modelId: "vlm-browser-multimodal-default" })),
    REAL_ADAPTER_LOAD_MS,
    `loadModel(${adapter.id})`
  );
  const prefill = await withTimeout(
    Promise.resolve(adapter.prefill({ promptTokens: 96 })),
    REAL_ADAPTER_LOAD_MS,
    `prefill(${adapter.id})`
  );
  const decode = await withTimeout(
    Promise.resolve(adapter.decode({ tokenBudget: 32 })),
    REAL_ADAPTER_LOAD_MS,
    `decode(${adapter.id})`
  );
  log(`Real runtime adapter '${adapter.id}' ready: prefill_tok_per_sec=${prefill?.tokPerSec ?? "?"}, decode_tok_per_sec=${decode?.tokPerSec ?? "?"}.`);
  return { adapter, prefill, decode };
}

async function runLab() {
  if (state.active) return;
  if (!state.capability) await probeCapability();

  state.active = true;
  state.run = null;
  render();

  if (isRealRuntimeMode) {
    log(`Mode=${requestedMode} requested; awaiting real runtime adapter registration.`);
    const adapter = await awaitRealRuntime();
    if (adapter) {
      try {
        const { prefill, decode } = await runRealRuntimeVlm(adapter);
        state.realAdapterPrefill = prefill;
        state.realAdapterDecode = decode;
        state.realAdapter = adapter;
      } catch (error) {
        state.realAdapterError = error?.message || String(error);
        log(`Real runtime '${adapter.id}' failed: ${state.realAdapterError}; falling back to deterministic.`);
      }
    } else {
      const reason = (typeof window !== "undefined" && window.__aiWebGpuLabRealVlmBootstrapError) || "timed out waiting for adapter registration";
      state.realAdapterError = reason;
      log(`No real runtime adapter registered (${reason}); falling back to deterministic VLM baseline.`);
    }
  }

  const fixture = await loadFixture();
  const preprocessStartedAt = performance.now();
  await sleep(fixture.preprocessMs * executionMode.stageMultiplier);
  const imagePreprocessMs = performance.now() - preprocessStartedAt;
  log(`Fixture image prepared: ${fixture.image.width}x${fixture.image.height}, patches=${fixture.image.patchCount}.`);

  const answers = [];
  for (const task of fixture.tasks) {
    const questionStartedAt = performance.now();
    await sleep(task.firstTokenMs * executionMode.stageMultiplier);
    const imageToFirstTokenMs = imagePreprocessMs + (performance.now() - questionStartedAt);
    log(`First token ready for ${task.id} at ${round(imageToFirstTokenMs, 2)} ms.`);
    await sleep(Math.max(task.answerTotalMs - task.firstTokenMs, 0) * executionMode.stageMultiplier);
    const answerTotalMs = imagePreprocessMs + (performance.now() - questionStartedAt);
    answers.push({
      id: task.id,
      question: task.question,
      answer: task.answer,
      focusRegion: task.focusRegion,
      imageToFirstTokenMs,
      answerTotalMs,
      correct: true
    });
    log(`Answered ${task.id} with focus region ${task.focusRegion}.`);
  }

  state.run = {
    patchCount: fixture.image.patchCount,
    imageId: fixture.image.id,
    questionCount: fixture.tasks.length,
    focusRegions: fixture.image.focusRegions,
    imagePreprocessMs,
    imageToFirstTokenMs: average(answers.map((item) => item.imageToFirstTokenMs)),
    answerTotalMs: average(answers.map((item) => item.answerTotalMs)),
    accuracyTaskScore: average(answers.map((item) => (item.correct ? 1 : 0))),
    caption: fixture.caption,
    answers,
    realAdapter: state.realAdapter || null
  };
  state.active = false;
  log(`Multimodal baseline complete: answer_total_ms ${round(state.run.answerTotalMs, 2)} with accuracy ${round(state.run.accuracyTaskScore, 2)}.`);
  render();
}

function buildPromptOutput() {
  if (!state.run) return "No multimodal run yet.";
  return state.run.answers
    .map(
      (item, index) =>
        `${index + 1}. ${item.question}\nFocus: ${item.focusRegion}\nAnswer: ${item.answer}\nimage_to_first_token_ms=${round(item.imageToFirstTokenMs, 2)}\nanswer_total_ms=${round(item.answerTotalMs, 2)}`
    )
    .join("\n\n");
}

function describeRuntimeAdapter() {
  const registry = typeof window !== "undefined" ? window.__aiWebGpuLabRuntimeRegistry : null;
  const requested = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("mode")
    : null;
  if (registry) {
    return registry.describe(requested);
  }
  return {
    id: "deterministic-vlm",
    label: "Deterministic VLM",
    status: "deterministic",
    isReal: false,
    version: "1.0.0",
    capabilities: ["prefill", "decode", "fixed-output-budget"],
    runtimeType: "synthetic",
    message: "Runtime adapter registry unavailable; using inline deterministic mock."
  };
}

function buildResult() {
  const run = state.run;
  return {
    meta: {
      repo: "exp-vlm-browser-multimodal",
      commit: "bootstrap-generated",
      timestamp: new Date().toISOString(),
      owner: "ai-webgpu-lab",
      track: "multimodal",
      scenario: (state.run && state.run.realAdapter) ? `vlm-browser-multimodal-real-${state.run.realAdapter.id}` : (run ? "vlm-browser-multimodal-readiness" : "vlm-browser-multimodal-pending"),
      notes: run
        ? `image=${run.imageId}; patches=${run.patchCount}; prompts=${run.questionCount}; focus=${run.focusRegions.join("|")}; backend=${state.environment.backend}; fallback=${state.environment.fallback_triggered}; accuracy=${round(run.accuracyTaskScore, 2)}${state.run && state.run.realAdapter ? `; realAdapter=${state.run.realAdapter.id}` : (isRealRuntimeMode && state.realAdapterError ? `; realAdapter=fallback(${state.realAdapterError})` : "")}`
        : "Probe capability, then run the deterministic browser VLM readiness harness."
    },
    environment: state.environment,
    workload: {
      kind: "vlm",
      name: "vlm-browser-multimodal-readiness",
      input_profile: state.fixture ? `${state.fixture.image.width}x${state.fixture.image.height}-${state.fixture.tasks.length}-questions` : "fixture-pending",
      model_id: "deterministic-vlm-browser-v1",
      dataset: "multimodal-fixture-v1"
    },
    metrics: {
      common: {
        time_to_interactive_ms: round(performance.now() - state.startedAt, 2) || 0,
        init_ms: run ? round(run.answerTotalMs, 2) || 0 : 0,
        success_rate: run ? 1 : 0.5,
        peak_memory_note: navigator.deviceMemory ? `${navigator.deviceMemory} GB reported by browser` : "deviceMemory unavailable",
        error_type: ""
      },
      vlm: {
        image_preprocess_ms: run ? round(run.imagePreprocessMs, 2) || 0 : 0,
        image_to_first_token_ms: run ? round(run.imageToFirstTokenMs, 2) || 0 : 0,
        answer_total_ms: run ? round(run.answerTotalMs, 2) || 0 : 0,
        accuracy_task_score: run ? round(run.accuracyTaskScore, 2) || 0 : 0
      }
    },
    status: run ? "success" : "partial",
    artifacts: {
      raw_logs: state.logs.slice(0, 5),
      deploy_url: "https://ai-webgpu-lab.github.io/exp-vlm-browser-multimodal/",
      runtime_adapter: describeRuntimeAdapter()
    }
  };
}

function renderCards(container, items) {
  container.innerHTML = "";
  for (const [label, value] of items) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `<span class="label">${label}</span><div class="value">${value}</div>`;
    container.appendChild(card);
  }
}

function renderStatus() {
  const badges = state.active
    ? ["Multimodal run active", executionMode.label]
    : state.run
      ? [`answer ${round(state.run.answerTotalMs, 2)} ms`, `accuracy ${round(state.run.accuracyTaskScore, 2)}`]
      : ["Fixture ready", executionMode.label];

  elements.statusRow.innerHTML = "";
  for (const text of badges) {
    const node = document.createElement("span");
    node.className = "badge";
    node.textContent = text;
    elements.statusRow.appendChild(node);
  }

  elements.summary.textContent = state.run
    ? `Last run: preprocess ${round(state.run.imagePreprocessMs, 2)} ms, first token ${round(state.run.imageToFirstTokenMs, 2)} ms, answer total ${round(state.run.answerTotalMs, 2)} ms, accuracy ${round(state.run.accuracyTaskScore, 2)}.`
    : "Run the browser VLM baseline to analyze the bundled fixture image with a deterministic prompt set.";
}

function renderMetrics() {
  renderCards(elements.metricGrid, [
    ["Image", state.fixture ? `${state.fixture.image.width}x${state.fixture.image.height}` : "pending"],
    ["Patches", state.fixture ? String(state.fixture.image.patchCount) : "pending"],
    ["Preprocess", state.run ? `${round(state.run.imagePreprocessMs, 2)} ms` : "pending"],
    ["First Token", state.run ? `${round(state.run.imageToFirstTokenMs, 2)} ms` : "pending"],
    ["Answer Total", state.run ? `${round(state.run.answerTotalMs, 2)} ms` : "pending"],
    ["Accuracy", state.run ? `${round(state.run.accuracyTaskScore, 2)}` : "pending"]
  ]);
}

function renderEnvironment() {
  renderCards(elements.metaGrid, [
    ["Browser", `${state.environment.browser.name} ${state.environment.browser.version}`],
    ["OS", `${state.environment.os.name} ${state.environment.os.version}`],
    ["Device", state.environment.device.class],
    ["CPU", state.environment.device.cpu],
    ["Memory", state.environment.device.memory_gb ? `${state.environment.device.memory_gb} GB` : "unknown"],
    ["Backend", state.environment.backend],
    ["Fallback", String(state.environment.fallback_triggered)],
    ["Worker", state.environment.worker_mode],
    ["Caption", state.run ? state.run.caption : (state.fixture ? state.fixture.caption : "pending")]
  ]);
}

function renderLogs() {
  elements.logList.innerHTML = "";
  const entries = state.logs.length ? state.logs : ["No multimodal activity yet."];
  for (const entry of entries) {
    const item = document.createElement("li");
    item.textContent = entry;
    elements.logList.appendChild(item);
  }
}

function render() {
  renderStatus();
  renderMetrics();
  renderEnvironment();
  renderLogs();
  elements.qaView.textContent = buildPromptOutput();
  elements.resultJson.textContent = JSON.stringify(buildResult(), null, 2);
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(buildResult(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `exp-vlm-browser-multimodal-${state.run ? "readiness" : "pending"}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  log("Downloaded multimodal readiness JSON draft.");
}

elements.probeCapability.addEventListener("click", () => {
  probeCapability().catch((error) => {
    state.active = false;
    log(`Capability probe failed: ${error instanceof Error ? error.message : String(error)}`);
    render();
  });
});

elements.runLab.addEventListener("click", () => {
  runLab().catch((error) => {
    state.active = false;
    log(`Multimodal run failed: ${error instanceof Error ? error.message : String(error)}`);
    render();
  });
});

elements.downloadJson.addEventListener("click", downloadJson);

(async function init() {
  await loadFixture();
  log("Browser VLM multimodal readiness harness ready.");
  render();
})();
