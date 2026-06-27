import { db } from "./db.server";
import { logChange } from "./log.server";
import { nowLocalISO } from "../lib/time";

export type Comment = {
  id: number;
  body: string;
  commented_at: string;
  commented_error_min: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  mentions: number[]; // referenced record ids
};

export type CommentInput = {
  body: string;
  commented_at: string;
  commented_error_min: number | null;
  mentions: number[];
};

type Row = Omit<Comment, "mentions"> & { mention_ids: string | null };

const listStmt = db.prepare(
  `SELECT c.*,
          (SELECT group_concat(record_id) FROM comment_mentions WHERE comment_id = c.id) AS mention_ids
     FROM comments c
    WHERE c.deleted_at IS NULL
    ORDER BY c.commented_at DESC, c.id DESC
    LIMIT ?`,
);

function rowToComment(r: Row): Comment {
  const { mention_ids, ...rest } = r;
  return {
    ...rest,
    mentions: mention_ids ? mention_ids.split(",").map(Number) : [],
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
const insertMentionStmt = db.prepare(
  `INSERT OR IGNORE INTO comment_mentions (comment_id, record_id) VALUES (?, ?)`,
);
const deleteMentionsStmt = db.prepare(
  `DELETE FROM comment_mentions WHERE comment_id = ?`,
);

const createCommentTx = db.transaction((input: CommentInput): Comment => {
  const now = nowLocalISO();
  const row = insertCommentStmt.get({
    body: input.body,
    commented_at: input.commented_at,
    commented_error_min: input.commented_error_min,
    created_at: now,
    updated_at: now,
  }) as Omit<Comment, "mentions">;
  for (const rid of input.mentions) insertMentionStmt.run(row.id, rid);
  return { ...row, mentions: input.mentions };
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
    deleteMentionsStmt.run(id);
    for (const rid of input.mentions) insertMentionStmt.run(id, rid);
    return { ...row, mentions: input.mentions };
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
