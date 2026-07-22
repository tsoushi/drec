import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { nowLocalISO } from "../lib/time";

// Every DB mutation (create / update / delete) flows through logChange so there
// is a single, append-only record of changes — emitted to the server console
// and to a JSON-Lines file (data/changes.log, override with DREC_LOG).

const LOG_PATH = process.env.DREC_LOG ?? "data/changes.log";

export type ChangeOp = "create" | "update" | "delete";
export type ChangeEntity = "record" | "comment" | "mental";

export function logChange(
  op: ChangeOp,
  entity: ChangeEntity,
  id: number,
  data?: unknown,
): void {
  const entry: Record<string, unknown> = { at: nowLocalISO(), op, entity, id };
  if (data !== undefined) entry.data = data;
  const line = JSON.stringify(entry);

  console.log(`[drec] ${line}`);

  try {
    const dir = dirname(LOG_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(LOG_PATH, line + "\n", "utf8");
  } catch {
    // logging must never break a write; ignore file errors
  }
}

export type ChangeLogEntry = {
  at: string;
  op: ChangeOp;
  entity: ChangeEntity;
  id: number;
  data?: unknown;
};

/** Read the most recent change-log entries, newest first. */
export function readChangeLog(limit = 500): ChangeLogEntry[] {
  let text: string;
  try {
    text = readFileSync(LOG_PATH, "utf8");
  } catch {
    return [];
  }
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const entries: ChangeLogEntry[] = [];
  for (const line of lines.slice(-limit)) {
    try {
      entries.push(JSON.parse(line) as ChangeLogEntry);
    } catch {
      // skip malformed lines
    }
  }
  entries.reverse();
  return entries;
}
