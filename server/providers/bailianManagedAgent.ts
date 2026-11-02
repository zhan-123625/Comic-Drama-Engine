/**
 * 阿里云百炼 Managed Agents API 客户端实现
 * 对齐官方文档规范：https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-api-overview
 */

import { fetch as undiciFetch } from "undici";
import { logger } from "../logger.js";
import { formatErrorMessage } from "../errorFormat.js";

export interface BailianClientOptions {
  /** 阿里云百炼 API Key（形如 sk-xxx，可对应环境变量 DASHSCOPE_API_KEY） */
  apiKey: string;
  /** 阿里云百炼工作空间 ID（形如 ws_xxxxxxxxxxxx） */
  workspaceId: string;
  /** 服务地域，目前 Managed Agents 默认 cn-beijing */
  region?: string;
  /** 自定义 Endpoint，如果传入则优先使用 */
  customEndpoint?: string;
  /** 请求超时时间（毫秒），默认 120000ms */
  timeoutMs?: number;
}

export interface AgentModelSpec {
  id: string;
  [key: string]: unknown;
}

export interface CreateAgentParams {
  name: string;
  model: AgentModelSpec | string;
  system?: string;
  description?: string;
  tools?: unknown[];
}

export interface AgentEntity {
  id: string;
  name: string;
  model: AgentModelSpec;
  system?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface CreateEnvironmentParams {
  name: string;
  config?: {
    type?: string;
    [key: string]: unknown;
  };
}

export interface EnvironmentEntity {
  id: string;
  name: string;
  config?: Record<string, unknown>;
  createdAt?: string;
  [key: string]: unknown;
}

export interface CreateSessionParams {
  agent: {
    type: "agent";
    id: string;
  };
  environment_id?: string;
}

export interface SessionEntity {
  id: string;
  agent?: { type: string; id: string };
  environment_id?: string;
  status?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface UserMessageContent {
  type: "text";
  text: string;
}

export interface UserMessageInput {
  role: "user" | "assistant" | "system";
  type: "message";
  content: UserMessageContent[];
}

export interface SendEventParams {
  input: UserMessageInput[];
}

export interface ManagedAgentEvent {
  id?: string;
  type?: string;
  event?: string;
  session_status?: "idle" | "running" | "terminated" | "error" | string;
  data?: unknown;
  text?: string;
  raw?: string;
}

export class BailianAgentStudioClient {
  readonly apiKey: string;
  readonly workspaceId: string;
  readonly region: string;
  readonly endpoint: string;
  readonly timeoutMs: number;

  constructor(opts: BailianClientOptions) {
    if (!opts.apiKey) {
      throw new Error("BailianAgentStudioClient: apiKey 为必填项");
    }
    if (!opts.workspaceId) {
      throw new Error("BailianAgentStudioClient: workspaceId 为必填项（可在阿里云百炼控制台右上角查看）");
    }
    this.apiKey = opts.apiKey.trim();
    this.workspaceId = opts.workspaceId.trim();
    this.region = opts.region?.trim() || "cn-beijing";
    this.timeoutMs = opts.timeoutMs ?? 120_000;

    if (opts.customEndpoint?.trim()) {
      this.endpoint = opts.customEndpoint.trim().replace(/\/+$/, "");
    } else {
      this.endpoint = `https://${this.workspaceId}.${this.region}.maas.aliyuncs.com/api/v1/agentstudio`;
    }
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private async request<T>(path: string, method: "GET" | "POST" | "PUT" | "DELETE", body?: unknown): Promise<T> {
    const url = `${this.endpoint}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = this.getHeaders();

    try {
      const resp = await undiciFetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => "");
        logger.warn("Bailian Managed Agents API error", {
          status: resp.status,
          path,
          errorText: errorText.slice(0, 500),
        });
        throw new Error(`百炼 API 请求失败 [${resp.status}]: ${errorText || resp.statusText}`);
      }

      const json = (await resp.json()) as T;
      return json;
    } catch (err) {
      const msg = formatErrorMessage(err, 500);
      logger.error("Bailian API request network failure", { path, error: msg });
      throw new Error(`阿里云百炼网络请求异常 (${url}): ${msg}`);
    }
  }

  // ── Agent 资源管理 ──────────────────────────────────────────

  async createAgent(params: CreateAgentParams): Promise<AgentEntity> {
    const payload = {
      name: params.name,
      model: typeof params.model === "string" ? { id: params.model } : params.model,
      system: params.system,
      description: params.description,
      tools: params.tools,
    };
    return this.request<AgentEntity>("/agents", "POST", payload);
  }

  async getAgent(agentId: string): Promise<AgentEntity> {
    return this.request<AgentEntity>(`/agents/${encodeURIComponent(agentId)}`, "GET");
  }

  async listAgents(limit = 20, page?: string): Promise<{ items?: AgentEntity[]; next_page?: string }> {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (page) qs.set("page", page);
    return this.request<{ items?: AgentEntity[]; next_page?: string }>(`/agents?${qs.toString()}`, "GET");
  }

  async archiveAgent(agentId: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/agents/${encodeURIComponent(agentId)}/archive`, "POST");
  }

  // ── Environment 资源管理 ─────────────────────────────────────

  async createEnvironment(params: CreateEnvironmentParams): Promise<EnvironmentEntity> {
    const payload = {
      name: params.name,
      config: params.config || { type: "cloud" },
    };
    return this.request<EnvironmentEntity>("/environments", "POST", payload);
  }

  async getEnvironment(environmentId: string): Promise<EnvironmentEntity> {
    return this.request<EnvironmentEntity>(`/environments/${encodeURIComponent(environmentId)}`, "GET");
  }

  async listEnvironments(limit = 20): Promise<{ items?: EnvironmentEntity[] }> {
    return this.request<{ items?: EnvironmentEntity[] }>(`/environments?limit=${limit}`, "GET");
  }

  // ── Session 资源管理 ─────────────────────────────────────────

  async createSession(params: CreateSessionParams): Promise<SessionEntity> {
    return this.request<SessionEntity>("/sessions", "POST", params);
  }

  async getSession(sessionId: string): Promise<SessionEntity> {
    return this.request<SessionEntity>(`/sessions/${encodeURIComponent(sessionId)}`, "GET");
  }

  async listSessions(limit = 20): Promise<{ items?: SessionEntity[] }> {
    return this.request<{ items?: SessionEntity[] }>(`/sessions?limit=${limit}`, "GET");
  }

  async deleteSession(sessionId: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/sessions/${encodeURIComponent(sessionId)}`, "DELETE");
  }

  // ── Event 事件与交互 ────────────────────────────────────────

  async sendEvent(sessionId: string, params: SendEventParams): Promise<{ id?: string; status?: string }> {
    return this.request<{ id?: string; status?: string }>(
      `/sessions/${encodeURIComponent(sessionId)}/events`,
      "POST",
      params,
    );
  }

  /**
   * 发送单条文本用户消息
   */
  async sendUserMessage(sessionId: string, text: string): Promise<{ id?: string; status?: string }> {
    return this.sendEvent(sessionId, {
      input: [
        {
          role: "user",
          type: "message",
          content: [{ type: "text", text }],
        },
      ],
    });
  }

  /**
   * 订阅 Session 的 SSE 事件流（流式输出）
   */
  async *streamEvents(sessionId: string): AsyncGenerator<ManagedAgentEvent, void, unknown> {
    const url = `${this.endpoint}/sessions/${encodeURIComponent(sessionId)}/events/stream`;
    const resp = await undiciFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "text/event-stream",
      },
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => "");
      throw new Error(`无法连接 SSE 事件流 [${resp.status}]: ${err}`);
    }

    if (!resp.body) {
      throw new Error("SSE 响应未包含数据体");
    }

    // Node / Undici ReadableStream 处理
    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const block of lines) {
          if (!block.trim()) continue;
          const parsed = parseSseBlock(block);
          if (parsed) {
            yield parsed;
            if (parsed.session_status === "idle" || parsed.session_status === "terminated") {
              return;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 端到端便捷执行：创建或复用 Agent，开启 Session，发送 Prompt 并等待返回文本结果
   */
  async runPrompt(opts: {
    agentName?: string;
    model?: string;
    systemPrompt?: string;
    prompt: string;
    existingAgentId?: string;
    existingEnvironmentId?: string;
  }): Promise<{ reply: string; agentId: string; sessionId: string }> {
    let agentId = opts.existingAgentId;
    if (!agentId) {
      const agent = await this.createAgent({
        name: opts.agentName || "starfire-task-agent",
        model: opts.model || "qwen-plus",
        system: opts.systemPrompt || "你是一位专业的剧本与视频创意制作专家。",
      });
      agentId = agent.id;
    }

    let envId = opts.existingEnvironmentId;
    if (!envId) {
      const env = await this.createEnvironment({
        name: "starfire-default-env",
        config: { type: "cloud" },
      });
      envId = env.id;
    }

    const session = await this.createSession({
      agent: { type: "agent", id: agentId },
      environment_id: envId,
    });

    await this.sendUserMessage(session.id, opts.prompt);

    let finalReply = "";
    for await (const ev of this.streamEvents(session.id)) {
      if (ev.text) {
        finalReply += ev.text;
      } else if (typeof ev.data === "object" && ev.data !== null && "text" in ev.data) {
        finalReply += String((ev.data as { text?: unknown }).text || "");
      }
    }

    return {
      reply: finalReply,
      agentId,
      sessionId: session.id,
    };
  }
}

function parseSseBlock(block: string): ManagedAgentEvent | null {
  const lines = block.split("\n");
  let eventType = "message";
  let dataStr = "";

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataStr += line.slice(5).trim();
    }
  }

  if (!dataStr) return null;

  try {
    const data = JSON.parse(dataStr) as Record<string, unknown>;
    const text =
      typeof data.text === "string"
        ? data.text
        : typeof (data.delta as Record<string, unknown>)?.text === "string"
          ? String((data.delta as Record<string, unknown>).text)
          : "";

    return {
      type: eventType,
      data,
      text,
      session_status: (data.session_status as ManagedAgentEvent["session_status"]) || (data.status as string),
      raw: dataStr,
    };
  } catch {
    return {
      type: eventType,
      text: dataStr,
      raw: dataStr,
    };
  }
}
