import { db } from "./db.server";
import type { Rec } from "./records.server";
import type { Comment } from "./comments.server";

// Read-only queries for the /notes screen: page through "days that have
// content" (records or comments), newest first, and return everything in that
// day window in ascending time order.

export type NotesPage = {
  records: Rec[];
  comments: Comment[];
  /** Records mentioned by a loaded comment but outside the loaded day window. */
  mentionedRecords: Rec[];
  hasMore: boolean;
};

const daysStmt = db.prepare(
  `SELECT day FROM (
     SELECT substr(taken_at, 1, 10) AS day
       FROM records WHERE deleted_at IS NULL
     UNION
     SELECT substr(commented_at, 1, 10) AS day
       FROM comments WHERE deleted_at IS NULL
   )
   ORDER BY day DESC
   LIMIT ?`,
);

const recordsSinceStmt = db.prepare(
  `SELECT * FROM records
    WHERE deleted_at IS NULL AND taken_at >= ?
    ORDER BY taken_at, id`,
);

const commentsSinceStmt = db.prepare(
  `SELECT c.*,
          (SELECT group_concat(record_id) FROM comment_mentions WHERE comment_id = c.id) AS mention_ids
     FROM comments c
    WHERE c.deleted_at IS NULL AND c.commented_at >= ?
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

export function getNotesPage(dayLimit: number): NotesPage {
  const days = daysStmt.all(dayLimit + 1) as Array<{ day: string }>;
  const hasMore = days.length > dayLimit;
  const window = days.slice(0, dayLimit);
  if (window.length === 0) {
    return { records: [], comments: [], mentionedRecords: [], hasMore: false };
  }

  const minDay = window[window.length - 1].day;
  const records = recordsSinceStmt.all(minDay) as Rec[];
  const comments = (commentsSinceStmt.all(minDay) as CommentRow[]).map(toComment);

  const loaded = new Set(records.map((r) => r.id));
  const missing = Array.from(
    new Set(comments.flatMap((c) => c.mentions)),
  ).filter((id) => !loaded.has(id));
  const mentionedRecords =
    missing.length === 0
      ? []
      : (db
          .prepare(
            `SELECT * FROM records
              WHERE deleted_at IS NULL AND id IN (${missing.map(() => "?").join(",")})`,
          )
          .all(...missing) as Rec[]);

  return { records, comments, mentionedRecords, hasMore };
}
