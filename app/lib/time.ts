// All timestamps in drec are stored as naive *local* ISO strings
// ('YYYY-MM-DDTHH:mm:ss'), so lexical order equals chronological order and no
// timezone math is ever needed. These helpers are pure (no Node APIs) so they
// are safe to import from both server and client modules.

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Current local time as 'YYYY-MM-DDTHH:mm:ss'. */
export function nowLocalISO(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Current local time as 'YYYY-MM-DDTHH:mm' for <input type="datetime-local">. */
export function nowLocalInputValue(): string {
  return nowLocalISO().slice(0, 16);
}

/** Parse a naive local 'YYYY-MM-DDTHH:mm[:ss]' string into a local Date. */
export function parseLocal(s: string): Date {
  const [date, time = "00:00:00"] = s.split("T");
  const [y, mo, da] = date.split("-").map(Number);
  const [h, mi, se = 0] = time.split(":").map(Number);
  return new Date(y, mo - 1, da, h, mi, se);
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 'M/D(曜) HH:mm' for a record row. */
export function formatTaken(s: string): string {
  const d = parseLocal(s);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 'YYYY/M/D(曜)' for a day separator header. */
export function formatDateHeader(s: string): string {
  const d = parseLocal(s);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

/** 'YYYY-MM-DD' key used to detect day boundaries when grouping. */
export function dateKey(s: string): string {
  return s.slice(0, 10);
}
