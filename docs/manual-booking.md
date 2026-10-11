# Manual booking (stage 2)

Open **Tools → Manual time booking** (`/#/project-booking`). Requires the extended
Rust server's schema-4 manual-entry capability. Captured events are read-only in
this screen. Booked work lives in a separate AW-managed ledger and lane.

## Assign captured time, including a new task

1. Set From/Until in UTC as `YYYY-MM-DDTHH:mm:ss`, choose up to eight buckets,
   and click **Load lanes**. Each lane uses the same time scale. Overlapping
   observations within a bucket stack so they remain individually selectable.
2. Click event blocks to select/deselect them. The last clicked event shows its
   actual `data` fields for inspection. Selected duration is the union across all
   chosen buckets: overlap counts once, separated observations preserve gaps.
3. Click **Assign selected time**. Choose an existing project/task, or choose
   **Create a new task…**, select a parent project/task, and enter its name.
4. Add a concise work description and review the individual intervals. Click
   **Create task & book time** to create the task and booking in one transaction.
   The task inherits its parent's billing and reporting policies. A rejected
   booking creates neither an entry nor an unused task; the draft remains editable.

For offline work or a manual range, use **Add offline work / range**, then edit
the interval start/end. Multiple rows represent disjoint ranges. Start/end editor
fields are RFC3339 with `Z` or an explicit UTC offset, including nanosecond fractions
when needed. Intervals are half-open. Preview durations are exact; there is no
rounding policy. The timeline's pixel positions do not determine stored duration.

## Correct booked work

Click a project-lane block or its table **Edit** button. Change the start/end
fields to resize, change Assignment to reassign, or update the description. To
move the whole booking, enter its new first start in **Move entire booking to**,
click **Move draft**, review the shifted intervals, then **Save booking**. Gaps and
duration are preserved by a move. Controls currently use forms rather than dragging.

**Split saved booking** divides the saved entry at the supplied instant into two
new stable IDs, deleting the original via a retained tombstone, in one transaction.
Splitting inside a gap is legal when work remains on both sides. **Delete saved
booking** retains its tombstone and revision history. Split/delete operate on the
saved entry; save draft edits first. A history/restore viewer remains stage 3.

No two live entries in one workspace may overlap, even on different tasks or
between captured and offline work. The server rejects conflicts rather than
silently trimming, overwriting or counting overlap twice. Adjacent intervals are
allowed. Archived branches cannot receive new/reassigned bookings, while existing
assignments remain editable. Existing captured events and categories are unchanged.

## Data and connection behavior

Entries contain UUID, assigned node ID, description, UTC intervals, exact derived
`duration_ns` string, deletion flag, and source references (`bucket_id`, nullable
real `event_id`). These are module records, not emitted watcher event payloads.
No SQL/messages, raw bucket fields, titles or credentials are automatically copied
into entries. Event labels and actual fields are displayed only for inspection;
keep manually written descriptions free of sensitive content. Source IDs are
provenance, not proof of foreground attention or of a subsequently edited interval.
Unavailable event IDs remain null. Source removal never removes booked work.

All data and full before/after revisions remain local in AW's database with
indefinite retention. Persistent idempotency records share this retention. Manual
entries have no multi-device synchronization. Full workspace snapshots are the
initial bounded storage/API adapter; large histories will need finer-grained
storage/pagination before claiming scalable deployment.

Writes use workspace ETags and idempotency keys. Interrupted responses preserve
the exact operation in memory and block new changes until **Retry save** resolves
it. A retry can safely replay atomic task creation. A stale revision preserves the
draft; **Refresh workspace** retrieves the latest ledger before reapplying. Closing
or reloading the page discards an in-memory pending request: inspect server data
before recreating an edit. This is not a durable offline queue.

The inspection window is limited to seven days, eight lanes and 5,000 events per
lane. A lane exceeding the limit rejects the entire load with a request to narrow
the window; partial source data is never presented as complete. Select at most
1,000 observations. The existing AW event API represents duration as a JSON number;
the adapter preserves the decimal value received without further floating-point
duration arithmetic. It cannot recover precision already lost in that source API.
Sub-nanosecond source values are rejected. Timestamps/range boundaries require
representable RFC3339 dates. Work-date mapping/report slicing belongs to stage 3;
UTC elapsed durations already handle explicit DST offsets correctly.

## Validation

Use this checkout's `./scripts/validate-project-tracking.ps1` and the sibling
Rust checkout's script of the same name (`-Offline` supported there). GitHub
Actions is unavailable and not used. Windows local evidence:

- 116 backend tests passed, one existing ignored; formatting and scoped Clippy.
- 21 UI/router tests passed, scoped ESLint with zero warnings, production build.
- Real embedded-server browser test: two source lanes, actual-field inspection,
  overlapping/disjoint selection, create-task-and-book, split, offline booking,
  resize, move, reassign and delete. Three observations (10m, overlapping 10m,
  later 5m) produced 20m with the 5m gap intact. Split preserved the same 20m.
- Captured events compared unchanged before/after all browser operations; source
  deletion independence is a separate HTTP regression. SQLite reopen retains
  nanosecond intervals, assignments and missing source references.

[Synthetic booking screen](manual-booking-synthetic.jpg). No installed AW lifecycle,
macOS/Linux/Android runtime, large-history performance, or cross-device validation
is claimed. Daily/weekly reports, frozen exports, review/report states and complete
domain backup/restore remain stage 3.
