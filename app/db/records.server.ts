import { db } from "./db.server";
import { logChange } from "./log.server";
import { nowLocalISO } from "../lib/time";

export type Rec = {
  id: number;
  drug_name: string;
  product_name: string | null;
  amount: number | null;
  unit: string | null;
  taken_at: string;
  taken_error_min: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/** The user-editable fields of a record (everything except id/timestamps). */
export type RecordInput = {
  drug_name: string;
  product_name: string | null;
  amount: number | null;
  unit: string | null;
  taken_at: string;
  taken_error_min: number | null;
  note: string | null;
};

const listStmt = db.prepare(
  `SELECT * FROM records
    WHERE deleted_at IS NULL
    ORDER BY taken_at DESC, id DESC
    LIMIT ?`,
);

export function listRecords(limit = 300): Rec[] {
  return listStmt.all(limit) as Rec[];
}

const insertStmt = db.prepare(
  `INSERT INTO records
     (drug_name, product_name, amount, unit, taken_at, taken_error_min, note, created_at, updated_at)
   VALUES
     (@drug_name, @product_name, @amount, @unit, @taken_at, @taken_error_min, @note, @created_at, @updated_at)
   RETURNING *`,
);

export function createRecord(input: RecordInput): Rec {
  const now = nowLocalISO();
  const rec = insertStmt.get({ ...input, created_at: now, updated_at: now }) as Rec;
  logChange("create", "record", rec.id, rec);
  return rec;
}

// Note: created_at is intentionally never touched on update (it is immutable).
const updateStmt = db.prepare(
  `UPDATE records
      SET drug_name    = @drug_name,
          product_name = @product_name,
          amount       = @amount,
          unit         = @unit,
          taken_at        = @taken_at,
          taken_error_min = @taken_error_min,
          note            = @note,
          updated_at      = @updated_at
    WHERE id = @id AND deleted_at IS NULL
   RETURNING *`,
);

export function updateRecord(id: number, input: RecordInput): Rec | undefined {
  const rec = updateStmt.get({ ...input, id, updated_at: nowLocalISO() }) as
    | Rec
    | undefined;
  if (rec) logChange("update", "record", id, rec);
  return rec;
}

// Soft delete: keep the row, just stamp deleted_at so it drops out of queries.
const deleteStmt = db.prepare(
  `UPDATE records
      SET deleted_at = @now, updated_at = @now
    WHERE id = @id AND deleted_at IS NULL`,
);

export function softDeleteRecord(id: number): void {
  const info = deleteStmt.run({ id, now: nowLocalISO() });
  if (info.changes > 0) logChange("delete", "record", id);
}

export type Suggestions = {
  drugNames: string[];
  productNames: string[];
  units: string[];
};

function distinctColumn(column: "drug_name" | "product_name" | "unit"): string[] {
  // `column` is a fixed literal (never user input), so interpolation is safe.
  const rows = db
    .prepare(
      `SELECT ${column} AS v
         FROM records
        WHERE deleted_at IS NULL AND ${column} IS NOT NULL AND ${column} <> ''
        GROUP BY ${column}
        ORDER BY COUNT(*) DESC, MAX(taken_at) DESC
        LIMIT 50`,
    )
    .all() as Array<{ v: string }>;
  return rows.map((r) => r.v);
}

export function getSuggestions(): Suggestions {
  return {
    drugNames: distinctColumn("drug_name"),
    productNames: distinctColumn("product_name"),
    units: distinctColumn("unit"),
  };
}
