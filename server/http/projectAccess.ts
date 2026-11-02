import type express from "express";
import { store } from "../store.js";
import { notFound } from "./httpResponses.js";

export async function getProjectOr404(id: string, res: express.Response) {
  const p = await store.get(id);
  if (!p) {
    notFound(res);
    return null;
  }
  return p;
}
