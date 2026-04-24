import {
  pipeline,
  TextStreamer,
  InterruptableStoppingCriteria,
} from "@huggingface/transformers";

const MODEL_IDS = {
  "8b": "onnx-community/Bonsai-8B-ONNX",
  "4b": "onnx-community/Bonsai-4B-ONNX",
  "1.7b": "onnx-community/Bonsai-1.7B-ONNX",
};

async function detectWebGPU() {
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

class TextGenerationPipeline {
  static instances = new Map();

  static async getInstance(modelKey, progress_callback = null) {
    const modelId = MODEL_IDS[modelKey];
    if (!modelId) throw new Error(`Unknown model: ${modelKey}`);
    if (!this.instances.has(modelKey)) {
      const hasWebGPU = await detectWebGPU();
      const device = hasWebGPU ? "webgpu" : "wasm";
      const dtype = hasWebGPU ? "q1f16" : "q4";
      console.log(`[Bonsai] Using device: ${device}, dtype: ${dtype}`);
      this.instances.set(
        modelKey,
        pipeline("text-generation", modelId, {
          device,
          dtype,
          progress_callback,
        }),
      );
    }
    return this.instances.get(modelKey);
  }
}

const stopping_criteria = new InterruptableStoppingCriteria();
let current_model_key = null;

async function load(modelKey) {
  current_model_key = modelKey;
  self.postMessage({ status: "loading", progress: 0 });

  const generator = await TextGenerationPipeline.getInstance(
    modelKey,
    (info) => {
      if (info.status === "progress" || info.status === "progress_total") {
        const progress = info.progress ?? (info.loaded && info.total ? (info.loaded / info.total) * 100 : 0);
        self.postMessage({ status: "loading", progress: Number(progress) });
      }
    },
  );

  // Warm up with a single token
  const inputs = generator.tokenizer("a");
  await generator.model.generate({ ...inputs, max_new_tokens: 1 });

  self.postMessage({ status: "ready" });
}

async function generate({ messages, max_tokens = 1024, temperature = 0 }) {
  const generator = await TextGenerationPipeline.getInstance(current_model_key);

  let startTime;
  let numTokens = 0;
  let fullOutput = "";

  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (token) => {
      fullOutput += token;
      self.postMessage({ status: "token", token });
    },
    token_callback_function: () => {
      startTime ??= performance.now();
      numTokens++;
    },
  });

  try {
    const output = await generator(messages, {
      max_new_tokens: max_tokens,
      do_sample: temperature > 0,
      temperature: temperature > 0 ? temperature : undefined,
      streamer,
      stopping_criteria,
    });

    const generated = output[0].generated_text.at(-1).content;
    const tps = numTokens > 1 ? (numTokens / (performance.now() - startTime)) * 1000 : 0;
    self.postMessage({ status: "complete", output: generated, tps, numTokens });
  } catch (e) {
    self.postMessage({ status: "error", data: e.toString() });
  }
}

self.addEventListener("message", async (e) => {
  const { type, data } = e.data;
  switch (type) {
    case "load":
      load(data);
      break;
    case "generate":
      stopping_criteria.reset();
      generate(data);
      break;
    case "interrupt":
      stopping_criteria.interrupt();
      break;
    case "reset":
      stopping_criteria.reset();
      break;
  }
});
