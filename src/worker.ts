import * as ort from "onnxruntime-web";

import type { WorkerRequest, WorkerResponse } from "./shared/types";

interface InitMessage {
  modelUrl: string;
}

let sessionPromise: Promise<ort.InferenceSession> | null = null;

self.addEventListener("message", async (event: MessageEvent<InitMessage | WorkerRequest>) => {
  const data = event.data;

  if ("modelUrl" in data) {
    ort.env.wasm.wasmPaths = `${new URL("../ort/", self.location.href).toString()}`;
    sessionPromise = ort.InferenceSession.create(data.modelUrl, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    return;
  }

  if (!sessionPromise) {
    throw new Error("Worker used before model initialization");
  }

  const session = await sessionPromise;
  const tensor = new ort.Tensor("float32", Float32Array.from(data.features), [1, data.features.length]);
  const outputName = session.outputNames[0];
  const result = await session.run({
    input: tensor,
  });
  const score = Number(result[outputName].data[0]);

  const response: WorkerResponse = {
    id: data.id,
    score,
  };

  self.postMessage(response);
});
