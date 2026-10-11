import {
  instant,
  timestamp,
  eventSpan,
  union,
  duration,
  split,
  move,
} from '../../src/features/projects/booking';

const s = (a, b) => ({ start: `2026-10-11T10:${a}:00Z`, end: `2026-10-11T10:${b}:00Z` });
test('exact nanoseconds survive conversion, including before epoch', () => {
  ['2026-10-11T10:00:00.123456789Z', '1969-12-31T23:59:59.123456789Z'].forEach(t =>
    expect(timestamp(instant(t))).toBe(t)
  );
  expect(instant('2026-10-25T02:30:00+01:00') - instant('2026-10-25T02:30:00+02:00')).toBe(
    3600000000000n
  );
});
test('selected overlapping bucket observations union without filling gaps', () => {
  const spans = union([s('00', '10'), s('05', '15'), s('20', '25')]);
  expect(spans).toHaveLength(2);
  expect(duration(spans)).toBe(1200000000000n);
});
test('source interval clipping retains fractional duration without copying fields', () => {
  const span = eventSpan(
    { timestamp: '2026-10-11T09:59:59.999999999Z', duration: 1e-8, data: { sql: 'not copied' } },
    '2026-10-11T10:00:00Z',
    '2026-10-11T11:00:00Z'
  );
  expect(span.end).toBe('2026-10-11T10:00:00.000000009Z');
  expect(Object.keys(span)).toEqual(['start', 'end']);
});
test('split conserves effort across gaps and move preserves gap lengths', () => {
  const entry = {
    id: 'original',
    intervals: [s('00', '10'), s('20', '30')],
    sources: [],
    node_id: 'task',
    description: 'Synthetic',
    deleted: false,
  };
  const parts = split(entry, '2026-10-11T10:15:00Z');
  expect(parts.map(e => e.id)).not.toContain('original');
  expect(parts.reduce((sum, e) => sum + duration(e.intervals), 0n)).toBe(duration(entry.intervals));
  const moved = move(entry, '2026-10-11T11:00:00Z');
  expect(duration(moved.intervals)).toBe(duration(entry.intervals));
  expect(instant(moved.intervals[1].start) - instant(moved.intervals[0].end)).toBe(600000000000n);
});
