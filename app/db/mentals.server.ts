import { db } from "./db.server";
import { logChange } from "./log.server";
import { nowLocalISO } from "../lib/time";

// Mental-state records: a self-standing timeline entry (like a comment) holding
// a -10..10 score (REAL, decimals allowed) with its own recorded time and an
// optional ± timing tolerance. Kept separate from records/comments.

export type Mental = {
  id: number;
  score: number;
  recorded_at: string;
  recorded_error_min: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/** The user-editable fields of a mental-state record. */
export type MentalInput = {
  score: number;
  recorded_at: string;
  recorded_error_min: number | null;
};

const listStmt = db.prepare(
  `SELECT * FROM mental_states
    WHERE deleted_at IS NULL
    ORDER BY recorded_at DESC, id DESC
    LIMIT ?`,
);

export function listMentals(limit = 300): Mental[] {
  return listStmt.all(limit) as Mental[];
}

const insertStmt = db.prepare(
  `INSERT INTO mental_states
     (score, recorded_at, recorded_error_min, created_at, updated_at)
   VALUES
     (@score, @recorded_at, @recorded_error_min, @created_at, @updated_at)
   RETURNING *`,
);

export function createMental(input: MentalInput): Mental {
  const now = nowLocalISO();
  const m = insertStmt.get({ ...input, created_at: now, updated_at: now }) as Mental;
  logChange("create", "mental", m.id, m);
  return m;
}

// Note: created_at is intentionally never touched on update (it is immutable).
const updateStmt = db.prepare(
  `UPDATE mental_states
      SET score              = @score,
          recorded_at        = @recorded_at,
          recorded_error_min = @recorded_error_min,
          updated_at         = @updated_at
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

// Soft delete: keep the row, just stamp deleted_at so it drops out of queries.
const deleteStmt = db.prepare(
  `UPDATE mental_states
      SET deleted_at = @now, updated_at = @now
    WHERE id = @id AND deleted_at IS NULL`,
);

export function softDeleteMental(id: number): void {
  const info = deleteStmt.run({ id, now: nowLocalISO() });
  if (info.changes > 0) logChange("delete", "mental", id);
}
