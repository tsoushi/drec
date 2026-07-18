import { db } from "./db.server";
import type { Rec } from "./records.server";
import type { Comment } from "./comments.server";

// Read-only month window for the /calendar screen.

export type MonthData = {
  records: Rec[];
  comments: Comment[];
};

const recordsStmt = db.prepare(
  `SELECT * FROM records
    WHERE deleted_at IS NULL AND taken_at >= ? AND taken_at < ?
    ORDER BY taken_at, id`,
);

const commentsStmt = db.prepare(
  `SELECT c.*,
          (SELECT group_concat(record_id) FROM comment_mentions WHERE comment_id = c.id) AS mention_ids
     FROM comments c
    WHERE c.deleted_at IS NULL AND c.commented_at >= ? AND c.commented_at < ?
    ORDER BY c.commented_at, c.id`,
);

type CommentRow = Omit<Comment, "mentions"> & { mention_ids: string | null };

function toComment(r: CommentRow): Comment {
  const { mention_ids, ...rest } = r;
  return {
    ...rest,
    mentions: mention_ids ? mention_ids.split(",").map(Number) : [],
  };
}

/** month: 'YYYY-MM'. Returns everything in that calendar month, ascending. */
export function getMonthData(month: string): MonthData {
  const [y, m] = month.split("-").map(Number);
  const next =
    m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const from = `${month}-01`;
  return {
    records: recordsStmt.all(from, next) as Rec[],
    comments: (commentsStmt.all(from, next) as CommentRow[]).map(toComment),
  };
}
