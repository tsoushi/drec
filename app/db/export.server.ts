import { db } from "./db.server";
import type { Rec } from "./records.server";
import type { Comment } from "./comments.server";
import { nowLocalISO } from "../lib/time";

// Read-only full dumps for the /export screen. Exports intentionally include
// soft-deleted rows (deleted_at set) — this is a backup, not a view.

type CommentRow = Omit<Comment, "mentions"> & { mention_ids: string | null };

const allRecordsStmt = db.prepare(`SELECT * FROM records ORDER BY id`);
const allCommentsStmt = db.prepare(
  `SELECT c.*,
          (SELECT group_concat(record_id) FROM comment_mentions WHERE comment_id = c.id) AS mention_ids
     FROM comments c
    ORDER BY c.id`,
);

function allComments(): Comment[] {
  return (allCommentsStmt.all() as CommentRow[]).map((r) => {
    const { mention_ids, ...rest } = r;
    return {
      ...rest,
      mentions: mention_ids ? mention_ids.split(",").map(Number) : [],
    };
  });
}

export function getExportCounts() {
  const one = (sql: string) =>
    (db.prepare(sql).get() as { n: number }).n;
  return {
    records: one(`SELECT COUNT(*) n FROM records WHERE deleted_at IS NULL`),
    recordsDeleted: one(
      `SELECT COUNT(*) n FROM records WHERE deleted_at IS NOT NULL`,
    ),
    comments: one(`SELECT COUNT(*) n FROM comments WHERE deleted_at IS NULL`),
    commentsDeleted: one(
      `SELECT COUNT(*) n FROM comments WHERE deleted_at IS NOT NULL`,
    ),
  };
}

// CSV: RFC4180 quoting, BOM so Excel (Windows/CP932) opens UTF-8 correctly.
function csv(rows: Array<Array<string | number | null>>): string {
  const cell = (v: string | number | null): string => {
    if (v == null) return "";
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function exportRecordsCSV(): string {
  const rows = allRecordsStmt.all() as Rec[];
  return csv([
    [
      "id",
      "drug_name",
      "product_name",
      "amount",
      "unit",
      "taken_at",
      "taken_error_min",
      "peak_min",
      "note",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
    ...rows.map((r) => [
      r.id,
      r.drug_name,
      r.product_name,
      r.amount,
      r.unit,
      r.taken_at,
      r.taken_error_min,
      r.peak_min,
      r.note,
      r.created_at,
      r.updated_at,
      r.deleted_at,
    ]),
  ]);
}

export function exportCommentsCSV(): string {
  const rows = allComments();
  return csv([
    [
      "id",
      "body",
      "commented_at",
      "commented_error_min",
      "mention_record_ids",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
    ...rows.map((c) => [
      c.id,
      c.body,
      c.commented_at,
      c.commented_error_min,
      c.mentions.join(";"),
      c.created_at,
      c.updated_at,
      c.deleted_at,
    ]),
  ]);
}

export function exportJSON(): string {
  return JSON.stringify(
    {
      app: "drec",
      exported_at: nowLocalISO(),
      records: allRecordsStmt.all(),
      comments: allComments(),
    },
    null,
    2,
  );
}
