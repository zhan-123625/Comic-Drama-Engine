/**
 * 扩展点：新业务模块或模型提供方可在此注册，核心管线仅依赖接口而非具体实现。
 * 后续可将 LLM/生图/视频调用统一接入 Registry。
 */
export abstract class RegisteredCapability {
  abstract readonly id: string;
}

export class CapabilityRegistry {
  private readonly caps = new Map<string, RegisteredCapability>();

  register(cap: RegisteredCapability): void {
    this.caps.set(cap.id, cap);
  }

  get(id: string): RegisteredCapability | undefined {
    return this.caps.get(id);
  }
}

export const globalCapabilityRegistry = new CapabilityRegistry();
