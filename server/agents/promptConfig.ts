import { readConfig } from "../config.js";

export async function getPromptOverride(
  key: keyof NonNullable<Awaited<ReturnType<typeof readConfig>>["agentPrompts"]>,
) {
  const cfg = await readConfig();
  const v = cfg.agentPrompts?.[key];
  const s = typeof v === "string" ? v.trim() : "";
  return s || undefined;
}
