import { db } from "./db.server";
import type { Rec } from "./records.server";
import {
  buildMentions,
  recordIdsOf,
  MENTION_COLUMNS,
  type Comment,
} from "./comments.server";

// Read-only LIKE search across records and comments for the /search screen.

export type SearchResult = {
  records: Rec[];
  comments: Comment[];
  /** Records mentioned by a matched comment (for chip labels). */
  mentionedRecords: Rec[];
};

const recordsStmt = db.prepare(
  `SELECT * FROM records
    WHERE deleted_at IS NULL
      AND (drug_name LIKE @p ESCAPE '\\'
        OR product_name LIKE @p ESCAPE '\\'
        OR note LIKE @p ESCAPE '\\')
    ORDER BY taken_at DESC, id DESC
    LIMIT @limit`,
);

const commentsStmt = db.prepare(
  `SELECT c.*,${MENTION_COLUMNS}
     FROM comments c
    WHERE c.deleted_at IS NULL AND c.body LIKE @p ESCAPE '\\'
    ORDER BY c.commented_at DESC, c.id DESC
    LIMIT @limit`,
);

type CommentRow = Omit<Comment, "mentions"> & {
  record_mention_ids: string | null;
  comment_mention_ids: string | null;
  mental_mention_ids: string | null;
};

function toComment(r: CommentRow): Comment {
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

export function searchAll(q: string, limit = 100): SearchResult {
  const p = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const records = recordsStmt.all({ p, limit }) as Rec[];
  const comments = (commentsStmt.all({ p, limit }) as CommentRow[]).map(
    toComment,
  );

  const loaded = new Set(records.map((r) => r.id));
  const missing = Array.from(
    new Set(comments.flatMap((c) => recordIdsOf(c.mentions))),
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

  return { records, comments, mentionedRecords };
}
