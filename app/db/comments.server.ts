import { db } from "./db.server";
import { logChange } from "./log.server";
import { nowLocalISO } from "../lib/time";

/** A comment can mention 0..N records, other comments, and/or mental logs. */
export type MentionRef =
  | { kind: "record"; id: number }
  | { kind: "comment"; id: number }
  | { kind: "mental"; id: number };

export type Comment = {
  id: number;
  body: string;
  commented_at: string;
  commented_error_min: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  mentions: MentionRef[]; // referenced records and/or comments
};

export type CommentInput = {
  body: string;
  commented_at: string;
  commented_error_min: number | null;
  mentions: MentionRef[];
};

type Row = Omit<Comment, "mentions"> & {
  record_mention_ids: string | null;
  comment_mention_ids: string | null;
  mental_mention_ids: string | null;
};

/** The three group_concat subqueries every read path selects for a comment. */
export const MENTION_COLUMNS = `
          (SELECT group_concat(record_id) FROM comment_mentions
            WHERE comment_id = c.id) AS record_mention_ids,
          (SELECT group_concat(target_comment_id) FROM comment_comment_mentions
            WHERE comment_id = c.id) AS comment_mention_ids,
          (SELECT group_concat(mental_id) FROM comment_mental_mentions
            WHERE comment_id = c.id) AS mental_mention_ids`;

const listStmt = db.prepare(
  `SELECT c.*,${MENTION_COLUMNS}
     FROM comments c
    WHERE c.deleted_at IS NULL
    ORDER BY c.commented_at DESC, c.id DESC
    LIMIT ?`,
);

function idsOf(csv: string | null): number[] {
  return csv ? csv.split(",").map(Number) : [];
}

/**
 * Build a comment's typed mention list from the three group_concat CSV columns.
 * Shared by every read path (home / notes / search / calendar / export) so they
 * all decode mentions the same way.
 */
export function buildMentions(
  recordCsv: string | null,
  commentCsv: string | null,
  mentalCsv: string | null,
): MentionRef[] {
  return [
    ...idsOf(recordCsv).map((id) => ({ kind: "record" as const, id })),
    ...idsOf(commentCsv).map((id) => ({ kind: "comment" as const, id })),
    ...idsOf(mentalCsv).map((id) => ({ kind: "mental" as const, id })),
  ];
}

/** The referenced record ids among a mention list (other kinds dropped). */
export function recordIdsOf(mentions: MentionRef[]): number[] {
  return mentions.filter((m) => m.kind === "record").map((m) => m.id);
}

function rowToComment(r: Row): Comment {
  const { record_mention_ids, comment_mention_ids, mental_mention_ids, ...rest } = r;
  return {
    ...rest,
    mentions: buildMentions(
      record_mention_ids,
      comment_mention_ids,
      mental_mention_ids,
    ),
  };
}

export function listComments(limit = 300): Comment[] {
  return (listStmt.all(limit) as Row[]).map(rowToComment);
}

const insertCommentStmt = db.prepare(
  `INSERT INTO comments (body, commented_at, commented_error_min, created_at, updated_at)
   VALUES (@body, @commented_at, @commented_error_min, @created_at, @updated_at)
   RETURNING *`,
);
const insertRecordMentionStmt = db.prepare(
  `INSERT OR IGNORE INTO comment_mentions (comment_id, record_id) VALUES (?, ?)`,
);
const insertCommentMentionStmt = db.prepare(
  `INSERT OR IGNORE INTO comment_comment_mentions (comment_id, target_comment_id) VALUES (?, ?)`,
);
const insertMentalMentionStmt = db.prepare(
  `INSERT OR IGNORE INTO comment_mental_mentions (comment_id, mental_id) VALUES (?, ?)`,
);
const deleteRecordMentionsStmt = db.prepare(
  `DELETE FROM comment_mentions WHERE comment_id = ?`,
);
const deleteCommentMentionsStmt = db.prepare(
  `DELETE FROM comment_comment_mentions WHERE comment_id = ?`,
);
const deleteMentalMentionsStmt = db.prepare(
  `DELETE FROM comment_mental_mentions WHERE comment_id = ?`,
);

/** Persist the mention set for a comment, de-duped and without self-mention. */
function writeMentions(commentId: number, mentions: MentionRef[]): MentionRef[] {
  const seen = new Set<string>();
  const saved: MentionRef[] = [];
  for (const ref of mentions) {
    if (ref.kind === "comment" && ref.id === commentId) continue; // no self-mention
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (ref.kind === "record") insertRecordMentionStmt.run(commentId, ref.id);
    else if (ref.kind === "comment") insertCommentMentionStmt.run(commentId, ref.id);
    else insertMentalMentionStmt.run(commentId, ref.id);
    saved.push(ref);
  }
  return saved;
}

const createCommentTx = db.transaction((input: CommentInput): Comment => {
  const now = nowLocalISO();
  const row = insertCommentStmt.get({
    body: input.body,
    commented_at: input.commented_at,
    commented_error_min: input.commented_error_min,
    created_at: now,
    updated_at: now,
  }) as Omit<Comment, "mentions">;
  const mentions = writeMentions(row.id, input.mentions);
  return { ...row, mentions };
});

export function createComment(input: CommentInput): Comment {
  const c = createCommentTx(input);
  logChange("create", "comment", c.id, c);
  return c;
}

const updateCommentStmt = db.prepare(
  `UPDATE comments
      SET body = @body,
          commented_at = @commented_at,
          commented_error_min = @commented_error_min,
          updated_at = @updated_at
    WHERE id = @id AND deleted_at IS NULL
   RETURNING *`,
);

const updateCommentTx = db.transaction(
  (id: number, input: CommentInput): Comment | undefined => {
    const row = updateCommentStmt.get({
      id,
      body: input.body,
      commented_at: input.commented_at,
      commented_error_min: input.commented_error_min,
      updated_at: nowLocalISO(),
    }) as Omit<Comment, "mentions"> | undefined;
    if (!row) return undefined;
    deleteRecordMentionsStmt.run(id);
    deleteCommentMentionsStmt.run(id);
    deleteMentalMentionsStmt.run(id);
    const mentions = writeMentions(id, input.mentions);
    return { ...row, mentions };
  },
);

export function updateComment(id: number, input: CommentInput): Comment | undefined {
  const c = updateCommentTx(id, input);
  if (c) logChange("update", "comment", id, c);
  return c;
}

const deleteCommentStmt = db.prepare(
  `UPDATE comments SET deleted_at = @now, updated_at = @now
    WHERE id = @id AND deleted_at IS NULL`,
);

export function softDeleteComment(id: number): void {
  const info = deleteCommentStmt.run({ id, now: nowLocalISO() });
  if (info.changes > 0) logChange("delete", "comment", id);
}
