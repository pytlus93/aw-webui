import { v4 as uuid } from 'uuid';
import { ProjectNode, Snapshot } from './api';

export interface Span {
  start: string;
  end: string;
}
export interface SourceRef {
  bucket_id: string;
  event_id: number | null;
}
export interface Entry {
  id: string;
  node_id: string;
  description: string;
  intervals: Span[];
  sources: SourceRef[];
  deleted: boolean;
  duration_ns: string;
}

// Convert RFC3339 to exact epoch nanoseconds. Date is used only for the whole
// second/offset; fractional digits are retained separately as integers.
export function instant(value: string): bigint {
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!m || !Number.isFinite(Date.parse(`${m[1]}${m[3]}`)))
    throw new Error('Use a valid RFC3339 time including Z or a UTC offset.');
  if (new Date(Date.parse(`${m[1]}Z`)).toISOString().slice(0, 19) !== m[1])
    throw new Error('Invalid calendar date or time.');
  return BigInt(Date.parse(`${m[1]}${m[3]}`)) * 1000000n + BigInt((m[2] || '').padEnd(9, '0'));
}
export function timestamp(ns: bigint): string {
  let seconds = ns / 1000000000n;
  let fraction = ns % 1000000000n;
  if (fraction < 0n) {
    seconds -= 1n;
    fraction += 1000000000n;
  }
  return (
    new Date(Number(seconds * 1000n)).toISOString().slice(0, 19) +
    '.' +
    fraction.toString().padStart(9, '0') +
    'Z'
  );
}
export function durationSeconds(value: number): bigint {
  // AW exposes durations as JSON numbers. Preserve its decimal representation,
  // including exponents, without doing additional floating-point arithmetic.
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!m) throw new Error('Invalid source duration');
  const digits = BigInt(m[1] + (m[2] || ''));
  const scale = 9 + Number(m[3] || 0) - (m[2] || '').length;
  // Babel's legacy exponent transform calls Math.pow, which cannot accept
  // BigInt. Integer multiplication works in both production and test builds.
  const power = (exponent: number) => {
    let result = 1n;
    for (let i = 0; i < exponent; i++) result *= 10n;
    return result;
  };
  if (scale >= 0) return digits * power(scale);
  const divisor = power(-scale);
  if (digits % divisor !== 0n)
    throw new Error('Source duration has precision finer than nanoseconds.');
  return digits / divisor;
}
export function eventSpan(event, from: string, until: string): Span | null {
  const start = instant(event.timestamp);
  const end = start + durationSeconds(event.duration);
  const a = start > instant(from) ? start : instant(from);
  const b = end < instant(until) ? end : instant(until);
  return b > a ? { start: timestamp(a), end: timestamp(b) } : null;
}
export function union(spans: Span[]): Span[] {
  const sorted = spans
    .map(s => ({ start: instant(s.start), end: instant(s.end) }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const merged: { start: bigint; end: bigint }[] = [];
  for (const s of sorted) {
    if (s.end <= s.start) throw new Error('End time must be after start time.');
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = last.end > s.end ? last.end : s.end;
    else merged.push({ ...s });
  }
  return merged.map(s => ({ start: timestamp(s.start), end: timestamp(s.end) }));
}
export function duration(spans: Span[]): bigint {
  return union(spans).reduce((sum, s) => sum + instant(s.end) - instant(s.start), 0n);
}
export function humanDuration(ns: bigint): string {
  const seconds = ns / 1000000000n;
  const fraction = (ns % 1000000000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${seconds / 3600n}h ${(seconds % 3600n) / 60n}m ${seconds % 60n}${
    fraction ? '.' + fraction : ''
  }s`;
}
export function newTask(
  snapshot: Snapshot,
  parent: string,
  name: string,
  id = uuid()
): ProjectNode {
  return {
    id,
    workspace_id: snapshot.workspace_id,
    parent_id: parent,
    kind: 'task',
    name,
    description: '',
    case_id: null,
    archived: false,
    billing: 'inherited',
    reporting: { mode: 'inherited' },
    billing_terms: { currency: null, hourly_rate: null, fixed_fee: null },
  };
}
export function split(entry: Entry, at: string): Entry[] {
  const point = instant(at);
  const left: Span[] = [],
    right: Span[] = [];
  for (const s of entry.intervals) {
    if (instant(s.end) <= point) left.push(s);
    else if (instant(s.start) >= point) right.push(s);
    else {
      left.push({ start: s.start, end: timestamp(point) });
      right.push({ start: timestamp(point), end: s.end });
    }
  }
  if (!left.length || !right.length)
    throw new Error('Split time must leave booked time on both sides.');
  return [left, right].map(intervals => ({
    ...entry,
    id: uuid(),
    intervals,
    duration_ns: duration(intervals).toString(),
  }));
}
export function move(entry: Entry, to: string): Entry {
  const delta = instant(to) - instant(entry.intervals[0].start);
  return {
    ...entry,
    intervals: entry.intervals.map(s => ({
      start: timestamp(instant(s.start) + delta),
      end: timestamp(instant(s.end) + delta),
    })),
  };
}
