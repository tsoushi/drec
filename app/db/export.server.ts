import { db } from "./db.server";
import type { Rec } from "./records.server";
import type { Mental } from "./mentals.server";
import {
  buildMentions,
  mentalIdsOf,
  recordIdsOf,
  type Comment,
  type MentionRef,
} from "./comments.server";
import { nowLocalISO } from "../lib/time";

// Read-only full dumps for the /export screen. Exports intentionally include
// soft-deleted rows (deleted_at set) — this is a backup, not a view.

type CommentRow = Omit<Comment, "mentions"> & {
  record_mention_ids: string | null;
  comment_mention_ids: string | null;
  mental_mention_ids: string | null;
};

const allRecordsStmt = db.prepare(`SELECT * FROM records ORDER BY id`);
const allMentalsStmt = db.prepare(`SELECT * FROM mental_states ORDER BY id`);
const allCommentsStmt = db.prepare(
  `SELECT c.*,
          (SELECT group_concat(record_id) FROM comment_mentions
            WHERE comment_id = c.id) AS record_mention_ids,
          (SELECT group_concat(target_comment_id) FROM comment_comment_mentions
            WHERE comment_id = c.id) AS comment_mention_ids,
          (SELECT group_concat(target_mental_id) FROM comment_mental_mentions
            WHERE comment_id = c.id) AS mental_mention_ids
     FROM comments c
    ORDER BY c.id`,
);

function allComments(): Comment[] {
  return (allCommentsStmt.all() as CommentRow[]).map((r) => {
    const { record_mention_ids, comment_mention_ids, mental_mention_ids, ...rest } = r;
    return {
      ...rest,
      mentions: buildMentions(
        record_mention_ids,
        comment_mention_ids,
        mental_mention_ids,
      ),
    };
  });
}

function commentIdsOf(mentions: MentionRef[]): number[] {
  return mentions.filter((m) => m.kind === "comment").map((m) => m.id);
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
    mentals: one(`SELECT COUNT(*) n FROM mental_states WHERE deleted_at IS NULL`),
    mentalsDeleted: one(
      `SELECT COUNT(*) n FROM mental_states WHERE deleted_at IS NOT NULL`,
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
      "mention_comment_ids",
      "mention_mental_ids",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
    ...rows.map((c) => [
      c.id,
      c.body,
      c.commented_at,
      c.commented_error_min,
      recordIdsOf(c.mentions).join(";"),
      commentIdsOf(c.mentions).join(";"),
      mentalIdsOf(c.mentions).join(";"),
      c.created_at,
      c.updated_at,
      c.deleted_at,
    ]),
  ]);
}

export function exportMentalStatesCSV(): string {
  const rows = allMentalsStmt.all() as Mental[];
  return csv([
    [
      "id",
      "score",
      "recorded_at",
      "recorded_error_min",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
    ...rows.map((m) => [
      m.id,
      m.score,
      m.recorded_at,
      m.recorded_error_min,
      m.created_at,
      m.updated_at,
      m.deleted_at,
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
      mentals: allMentalsStmt.all(),
    },
    null,
    2,
  );
}
