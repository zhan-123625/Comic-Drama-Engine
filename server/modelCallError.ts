import type { ModelApiCallSnapshot } from "./types.js";

/** 模型调用失败时附带最后一次（或唯一一次）脱敏请求快照，供任务页展示 */
export class ModelCallFailedError extends Error {
  readonly modelApiCall?: ModelApiCallSnapshot;

  constructor(message: string, modelApiCall?: ModelApiCallSnapshot) {
    super(message);
    this.name = "ModelCallFailedError";
    this.modelApiCall = modelApiCall;
  }
}

export function getModelApiCallFromError(e: unknown): ModelApiCallSnapshot | undefined {
  return e instanceof ModelCallFailedError ? e.modelApiCall : undefined;
}
