// Real VLM (image-text-to-text) runtime integration sketch for exp-vlm-browser-multimodal.
//
// Gated by ?mode=real-vlm. Default deterministic harness path is untouched.
// `loadVlmFromCdn` is parameterized so tests can inject a stub.

const DEFAULT_TRANSFORMERS_VERSION = "3.0.0";
const DEFAULT_TRANSFORMERS_CDN = (version) => `https://esm.sh/@huggingface/transformers@${version}`;
const DEFAULT_MODEL_ID = "Xenova/SmolVLM-Instruct";
const DEFAULT_TASK = "image-text-to-text";

export async function loadVlmFromCdn({ version = DEFAULT_TRANSFORMERS_VERSION } = {}) {
  const transformers = await import(/* @vite-ignore */ DEFAULT_TRANSFORMERS_CDN(version));
  if (!transformers || typeof transformers.pipeline !== "function") {
    throw new Error("transformers module did not expose pipeline()");
  }
  return { transformers, pipeline: transformers.pipeline, env: transformers.env };
}

export function buildRealVlmAdapter({
  pipeline,
  env,
  version = DEFAULT_TRANSFORMERS_VERSION,
  modelId = DEFAULT_MODEL_ID,
  task = DEFAULT_TASK
}) {
  if (typeof pipeline !== "function") {
    throw new Error("buildRealVlmAdapter requires a callable pipeline");
  }
  const sanitized = modelId.replace(/[^A-Za-z0-9]/g, "-").toLowerCase();
  const id = `vlm-${sanitized}-${version.replace(/[^0-9]/g, "")}`;
  let runtime = null;

  return {
    id,
    label: `VLM ${modelId} (Transformers.js ${version})`,
    version,
    capabilities: ["prefill", "decode", "image-text-to-text", "fixed-output-budget"],
    loadType: "async",
    backendHint: "webgpu",
    isReal: true,
    async loadRuntime({ device = "webgpu", dtype = "q4" } = {}) {
      if (env && typeof env === "object") env.allowRemoteModels = true;
      runtime = await pipeline(task, modelId, { device, dtype });
      return runtime;
    },
    async prefill(_runtime, prompt) {
      const startedAt = performance.now();
      const text = (prompt && prompt.question) || String(prompt || "");
      const promptTokens = text.trim().split(/\s+/).filter(Boolean).length;
      const prefillMs = performance.now() - startedAt;
      return { promptTokens, prefillMs, text, image: prompt && prompt.image };
    },
    async decode(activeRuntime, prefillResult, outputTokenBudget = 64) {
      const target = activeRuntime || runtime;
      if (!target) {
        throw new Error("real vlm adapter requires loadRuntime() before decode()");
      }
      const startedAt = performance.now();
      const output = await target({
        image: prefillResult && prefillResult.image,
        text: prefillResult && prefillResult.text
      }, { max_new_tokens: outputTokenBudget });
      const decodeMs = performance.now() - startedAt;
      const text = Array.isArray(output) && output[0] && output[0].generated_text
        ? output[0].generated_text
        : (typeof output === "string" ? output : "");
      const tokens = text.split(/\s+/).filter(Boolean).length || outputTokenBudget;
      return {
        tokens,
        decodeMs,
        text,
        ttftMs: decodeMs / Math.max(tokens, 1),
        decodeTokPerSec: tokens / Math.max(decodeMs / 1000, 0.001)
      };
    }
  };
}

export async function connectRealVlm({
  registry = typeof window !== "undefined" ? window.__aiWebGpuLabRuntimeRegistry : null,
  loader = loadVlmFromCdn,
  version = DEFAULT_TRANSFORMERS_VERSION,
  modelId = DEFAULT_MODEL_ID,
  task = DEFAULT_TASK
} = {}) {
  if (!registry) {
    throw new Error("runtime registry not available");
  }
  const { pipeline, env } = await loader({ version });
  if (typeof pipeline !== "function") {
    throw new Error("loaded pipeline is not callable");
  }
  const adapter = buildRealVlmAdapter({ pipeline, env, version, modelId, task });
  registry.register(adapter);
  return { adapter, pipeline, env };
}

if (typeof window !== "undefined" && window.location && typeof window.location.search === "string") {
  const params = new URLSearchParams(window.location.search);
  if (params.get("mode") === "real-vlm" && !window.__aiWebGpuLabRealVlmBootstrapping) {
    window.__aiWebGpuLabRealVlmBootstrapping = true;
    connectRealVlm().catch((error) => {
      console.warn(`[real-vlm] bootstrap failed: ${error.message}`);
      window.__aiWebGpuLabRealVlmBootstrapError = error.message;
    });
  }
}
