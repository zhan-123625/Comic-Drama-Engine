import type { Response } from "express";
import type { PipelineEvent } from "./types.js";

interface SSEConnection {
  res: Response;
  lastHeartbeat: number;
  heartbeatInterval: ReturnType<typeof setInterval>;
  timeoutCheck: ReturnType<typeof setInterval>;
}

const byProject = new Map<string, Set<SSEConnection>>();

/** 无 SSE 连接时仍暂存最近事件，新连接建立后重放，避免「点运行后一直等不到日志」的竞态 */
const RECENT_MAX = 320;
const HEARTBEAT_INTERVAL_MS = Math.max(5_000, Number(process.env.MY_APP_SSE_HEARTBEAT_MS || 30_000));
const STALE_TIMEOUT_MS = Math.max(30_000, Number(process.env.MY_APP_SSE_STALE_MS || 120_000));
const STALE_CHECK_INTERVAL_MS = Math.max(5_000, Number(process.env.MY_APP_SSE_STALE_CHECK_MS || 60_000));
const recentLinesByProject = new Map<string, string[]>();

function pushRecentLine(projectId: string, line: string) {
  let arr = recentLinesByProject.get(projectId);
  if (!arr) {
    arr = [];
    recentLinesByProject.set(projectId, arr);
  }
  arr.push(line);
  if (arr.length > RECENT_MAX) arr.splice(0, arr.length - RECENT_MAX);
}

/** 新一次管线开始时清空，避免重连用户看到上一轮残留 */
export function sseClearRecent(projectId: string) {
  recentLinesByProject.delete(projectId);
}

export function sseAddClient(projectId: string, res: Response) {
  let set = byProject.get(projectId);
  if (!set) {
    set = new Set();
    byProject.set(projectId, set);
  }

  // eslint-disable-next-line prefer-const
  let connection: SSEConnection;

  // ✅ 定期发送心跳信号（每 30 秒）
  const heartbeatInterval = setInterval(() => {
    if (!res.writableEnded) {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
        connection.lastHeartbeat = Date.now();
      } catch {
        // 发送失败，会在错误监听器中清理
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  // ✅ 检测超时客户端（2 分钟无通信则断开）
  const timeoutCheck = setInterval(() => {
    const now = Date.now();
    if (now - connection.lastHeartbeat > STALE_TIMEOUT_MS) {
      try {
        res.end();
      } catch {
        // 已断开
      }
    }
  }, STALE_CHECK_INTERVAL_MS);

  connection = {
    res,
    lastHeartbeat: Date.now(),
    heartbeatInterval,
    timeoutCheck,
  };

  set.add(connection);

  // 重放最近的日志
  const buffered = recentLinesByProject.get(projectId);
  if (buffered?.length) {
    for (const line of buffered) {
      try {
        res.write(line);
      } catch {
        sseRemoveClient(projectId, res);
        return;
      }
    }
  }

  // ✅ 监听连接关闭事件，及时清理
  const cleanup = () => {
    sseRemoveClient(projectId, res);
  };

  res.on("finish", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);
}

export function sseRemoveClient(projectId: string, res: Response) {
  const set = byProject.get(projectId);
  if (!set) return;

  // ✅ 查找并清理连接对象
  for (const conn of set) {
    if (conn.res === res) {
      clearInterval(conn.heartbeatInterval);
      clearInterval(conn.timeoutCheck);
      set.delete(conn);
      break;
    }
  }

  if (set.size === 0) byProject.delete(projectId);
}

export function sseSend(projectId: string, event: PipelineEvent) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  pushRecentLine(projectId, line);
  const set = byProject.get(projectId);
  if (!set?.size) return;

  // ✅ 遍历时跟踪失败的连接，以便及时清理
  const failed: SSEConnection[] = [];
  for (const conn of set) {
    try {
      conn.res.write(line);
      conn.lastHeartbeat = Date.now();
    } catch {
      failed.push(conn);
    }
  }

  // 清理失败的连接
  for (const conn of failed) {
    sseRemoveClient(projectId, conn.res);
  }
}
