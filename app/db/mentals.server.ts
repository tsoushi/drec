import { db } from "./db.server";
import { logChange } from "./log.server";
import { nowLocalISO } from "../lib/time";

// Mental-state log: a self-reported level from -10..10 with its own timeline
// position, mirroring records/comments (edit + soft delete, logChange-audited).
// The range bounds live in ../lib/mental so the client bundle can use them too.

export type Mental = {
  id: number;
  level: number;
  recorded_at: string;
  recorded_error_min: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type MentalInput = {
  level: number;
  recorded_at: string;
  recorded_error_min: number | null;
};

const listStmt = db.prepare(
  `SELECT * FROM mentals
    WHERE deleted_at IS NULL
    ORDER BY recorded_at DESC, id DESC
    LIMIT ?`,
);

export function listMentals(limit = 300): Mental[] {
  return listStmt.all(limit) as Mental[];
}

const insertStmt = db.prepare(
  `INSERT INTO mentals (level, recorded_at, recorded_error_min, created_at, updated_at)
   VALUES (@level, @recorded_at, @recorded_error_min, @created_at, @updated_at)
   RETURNING *`,
);

export function createMental(input: MentalInput): Mental {
  const now = nowLocalISO();
  const m = insertStmt.get({ ...input, created_at: now, updated_at: now }) as Mental;
  logChange("create", "mental", m.id, m);
  return m;
}

// created_at is immutable — never touched on update.
const updateStmt = db.prepare(
  `UPDATE mentals
      SET level = @level,
          recorded_at = @recorded_at,
          recorded_error_min = @recorded_error_min,
          updated_at = @updated_at
    WHERE id = @id AND deleted_at IS NULL
   RETURNING *`,
);

export function updateMental(id: number, input: MentalInput): Mental | undefined {
  const m = updateStmt.get({ ...input, id, updated_at: nowLocalISO() }) as
    | Mental
    | undefined;
  if (m) logChange("update", "mental", id, m);
  return m;
}

const deleteStmt = db.prepare(
  `UPDATE mentals SET deleted_at = @now, updated_at = @now
    WHERE id = @id AND deleted_at IS NULL`,
);

export function softDeleteMental(id: number): void {
  const info = deleteStmt.run({ id, now: nowLocalISO() });
  if (info.changes > 0) logChange("delete", "mental", id);
}
