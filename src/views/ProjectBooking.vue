<template>
  <section>
    <div class="d-flex justify-content-between">
      <h3>Manual time booking</h3>
      <router-link to="/projects">Manage projects &amp; tasks</router-link>
    </div>
    <p class="text-muted">
      Inspect captured activity in parallel lanes and book work separately. Times below are UTC.
      Bucket context is evidence for your decision; selecting it does not prove foreground work.
    </p>
    <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
    <div v-if="notice" class="alert alert-success" role="status">{{ notice }}</div>
    <div v-if="pending" class="alert alert-warning">
      Save response interrupted. Retry the exact change before another edit.
      <button class="btn btn-sm btn-outline-dark" :disabled="busy" @click="retry">
        Retry save
      </button>
    </div>
    <div v-if="unsupported" class="alert alert-info">
      Manual booking requires the extended Rust server with the manual-entry module.
    </div>
    <template v-if="snapshot">
      <form class="mb-3" @submit.prevent="loadLanes">
        <fieldset :disabled="busy || pending">
          <div class="row">
            <label class="col-md-4"
              >From (UTC)<input
                v-model="fromInput"
                class="form-control"
                type="text"
                step="1"
                required /></label
            ><label class="col-md-4"
              >Until (UTC)<input
                v-model="untilInput"
                class="form-control"
                type="text"
                step="1"
                required
            /></label>
            <div class="col-md-4 align-self-end mb-2">
              <button class="btn btn-outline-primary mr-2">Load lanes</button
              ><button type="button" class="btn btn-outline-secondary" @click="refresh">
                Refresh workspace
              </button>
            </div>
          </div>
          <details>
            <summary>Select source buckets (up to eight)</summary>
            <label v-for="bucket in buckets" :key="bucket.id" class="d-block"
              ><input v-model="bucketIds" type="checkbox" :value="bucket.id" /> {{ bucket.id }} ·
              {{ bucket.type }} · {{ bucket.hostname || 'Unknown host' }}</label
            >
            <p v-if="!buckets.length">No source buckets. You can still add offline work.</p>
          </details>
        </fieldset>
      </form>
      <p v-if="busy" role="status">Loading or saving…</p>
      <div class="booking-timeline mb-3">
        <div class="timeline-row">
          <div class="lane-name">UTC</div>
          <div class="lane-clock">
            <span v-for="tick in ticks" :key="tick.left" :style="{ left: tick.left + '%' }">{{
              tick.text
            }}</span>
          </div>
        </div>
        <div v-for="lane in lanes" :key="lane.id" class="timeline-row">
          <div class="lane-name">{{ lane.id }}</div>
          <div class="lane-track" :style="{ height: lane.height + 'px' }">
            <button
              v-for="item in lane.items"
              :key="item.key"
              class="activity-block"
              :class="{ chosen: selected.includes(item.key) }"
              :style="blockStyle(item.span, item.row)"
              :title="item.label"
              :aria-label="item.label"
              :aria-pressed="selected.includes(item.key)"
              :disabled="busy || pending"
              @click="toggle(item)"
            >
              {{ item.label }}
            </button>
          </div>
        </div>
        <div class="timeline-row">
          <div class="lane-name">Project entries</div>
          <div class="lane-track" style="height: 38px">
            <template v-for="entry in visibleEntries"
              ><button
                v-for="(span, index) in entry.intervals"
                :key="entry.id + index"
                class="entry-block"
                :style="blockStyle(span, 0)"
                :title="nodeName(entry.node_id) + ' — ' + entry.description"
                :aria-label="'Edit booking: ' + nodeName(entry.node_id)"
                :disabled="busy || pending"
                @click="editEntry(entry)"
              >
                {{ nodeName(entry.node_id) }}
              </button></template
            >
          </div>
        </div>
      </div>
      <div class="mb-3">
        <button
          class="btn btn-primary mr-2"
          :disabled="busy || pending || !selected.length"
          @click="assignSelected"
        >
          Assign selected time</button
        ><button
          class="btn btn-outline-secondary mr-2"
          :disabled="busy || pending"
          @click="clearSelection"
        >
          Clear selection</button
        ><button class="btn btn-outline-primary" :disabled="busy || pending" @click="offline">
          Add offline work / range
        </button>
        <p v-if="selected.length" class="mt-2">
          {{ selected.length }} observations · {{ selectedDuration }} after union; disjoint gaps
          stay empty.
        </p>
      </div>
      <details v-if="inspected" class="mb-3" open>
        <summary>
          Actual fields — {{ inspected.bucket }} / event
          {{ inspected.event.id == null ? 'ID unavailable' : inspected.event.id }}
        </summary>
        <p class="small">
          {{ inspected.event.timestamp }} · {{ inspected.event.duration }} seconds. Fields are
          displayed for inspection and are not copied into bookings.
        </p>
        <pre>{{ JSON.stringify(inspected.event.data, null, 2) }}</pre>
      </details>
      <section
        v-if="draft"
        class="card card-body mb-4"
        role="dialog"
        aria-label="Assign or edit booked time"
      >
        <h4>{{ editing ? 'Edit booked work' : 'Assign time' }}</h4>
        <form @submit.prevent="save">
          <fieldset :disabled="busy || pending">
            <label class="w-100"
              >Assignment<select v-model="target" class="form-control">
                <option v-for="row in assignable" :key="row.node.id" :value="row.node.id">
                  {{ row.path }}
                </option>
                <option value="new-task">Create a new task…</option>
              </select></label
            >
            <div v-if="target === 'new-task'" class="row">
              <label class="col-md-6"
                >Parent project or task<select v-model="taskParent" class="form-control" required>
                  <option v-for="row in activeNodes" :key="row.node.id" :value="row.node.id">
                    {{ row.path }}
                  </option>
                </select></label
              ><label class="col-md-6"
                >New task name<input
                  v-model="taskName"
                  class="form-control"
                  required
                  maxlength="1024"
              /></label>
              <p class="col-12 text-muted small">
                The new task inherits billing/reporting policies. Task creation and booking save
                together.
              </p>
            </div>
            <label class="w-100"
              >Work description<textarea
                v-model="draft.description"
                class="form-control"
                maxlength="16384"
                placeholder="Concise summary; omit SQL, messages and credentials."
              />
            </label>
            <div v-for="(span, index) in draft.intervals" :key="index" class="row">
              <label class="col-md-5"
                >Start (UTC/offset)<input
                  v-model="span.start"
                  class="form-control"
                  required
                  placeholder="2026-10-11T10:00:00Z" /></label
              ><label class="col-md-5"
                >End (exclusive)<input
                  v-model="span.end"
                  class="form-control"
                  required
                  placeholder="2026-10-11T11:00:00Z"
              /></label>
              <div class="col-md-2 align-self-end mb-2">
                <button
                  type="button"
                  class="btn btn-outline-danger"
                  :disabled="draft.intervals.length === 1"
                  @click="draft.intervals.splice(index, 1)"
                >
                  Remove
                </button>
              </div>
            </div>
            <p class="small">
              RFC3339 timestamps include Z or an explicit UTC offset. Change start/end to resize;
              separate rows preserve gaps. Duration: {{ draftDuration }}.
            </p>
            <button type="button" class="btn btn-link" @click="addSpan">
              Add another interval
            </button>
            <div>
              <button class="btn btn-primary mr-2">
                {{ target === 'new-task' ? 'Create task & book time' : 'Save booking' }}</button
              ><button type="button" class="btn btn-outline-secondary" @click="draft = null">
                Cancel
              </button>
            </div>
          </fieldset>
        </form>
        <fieldset v-if="editing" class="mt-3" :disabled="busy || pending">
          <label class="w-100"
            >Move entire booking to (new first start)<input
              v-model="moveTo"
              class="form-control"
              placeholder="2026-10-11T12:00:00Z" /></label
          ><button class="btn btn-outline-secondary" @click="moveDraft">Move draft</button
          ><label class="w-100 mt-3"
            >Split at (UTC/offset)<input
              v-model="splitAt"
              class="form-control"
              placeholder="2026-10-11T10:30:00Z" /></label
          ><button class="btn btn-outline-secondary mr-2" @click="splitEntry">
            Split saved booking</button
          ><button class="btn btn-outline-danger" @click="deleteEntry">Delete saved booking</button>
          <p class="small text-muted mt-2">
            Split/delete operate on the saved entry. Save draft changes first. Deleted entries
            retain revision history.
          </p>
        </fieldset>
      </section>
      <h4>Booked work in this window</h4>
      <p v-if="!visibleEntries.length">No booked entries in this window.</p>
      <table v-else class="table table-sm">
        <thead>
          <tr>
            <th>Task/project</th>
            <th>UTC intervals</th>
            <th>Duration</th>
            <th>Description</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in visibleEntries" :key="entry.id">
            <td>{{ nodeName(entry.node_id) }}</td>
            <td>
              <div v-for="span in entry.intervals" :key="span.start">
                {{ span.start }} → {{ span.end }}
              </div>
            </td>
            <td>{{ human(entry.duration_ns) }}</td>
            <td>{{ entry.description }}</td>
            <td>
              <button
                class="btn btn-sm btn-outline-secondary"
                :disabled="busy || pending"
                @click="editEntry(entry)"
              >
                Edit
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<script lang="ts">
/* global BigInt */
import Vue from 'vue';
import { v4 as uuid } from 'uuid';
import { getClient } from '~/util/awclient';
import { ProjectsApi, Snapshot, rows } from '~/features/projects/api';
import {
  Entry,
  Span,
  eventSpan,
  instant,
  timestamp,
  union,
  duration,
  humanDuration,
  newTask,
  split,
  move,
} from '~/features/projects/booking';
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export default Vue.extend({
  data() {
    const day = new Date().toISOString().slice(0, 10);
    const until = new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString();
    return {
      api: null as ProjectsApi | null,
      snapshot: null as Snapshot | null,
      buckets: [] as any[],
      bucketIds: [] as string[],
      lanes: [] as any[],
      selected: [] as string[],
      inspected: null as any,
      fromInput: day + 'T00:00:00',
      untilInput: until.slice(0, 19),
      loadedFrom: day + 'T00:00:00Z',
      loadedUntil: until,
      draft: null as Entry | null,
      editing: false,
      target: '',
      taskParent: '',
      taskName: '',
      taskId: '',
      moveTo: '',
      splitAt: '',
      busy: false,
      pending: false,
      unsupported: false,
      error: '',
      notice: '',
    };
  },
  computed: {
    activeNodes() {
      return rows(this.snapshot.nodes, '', false);
    },
    assignable() {
      return rows(this.snapshot.nodes, '', true).filter(
        r => !r.archived || (this.editing && r.node.id === this.draft?.node_id)
      );
    },
    visibleEntries(): Entry[] {
      return (this.snapshot.entries || []).filter(
        e =>
          !e.deleted &&
          e.intervals.some(
            s =>
              instant(s.end) > instant(this.loadedFrom) &&
              instant(s.start) < instant(this.loadedUntil)
          )
      );
    },
    ticks() {
      const from = instant(this.loadedFrom),
        span = instant(this.loadedUntil) - from;
      return [0, 25, 50, 75, 100].map(p => ({
        left: p,
        text: timestamp(from + (span * BigInt(p)) / 100n).slice(11, 16),
      }));
    },
    selectedItems(): any[] {
      return this.lanes.flatMap(l => l.items).filter(i => this.selected.includes(i.key));
    },
    selectedDuration(): string {
      try {
        return humanDuration(duration(this.selectedItems.map(i => i.span)));
      } catch {
        return 'Invalid selection';
      }
    },
    draftDuration(): string {
      try {
        return humanDuration(duration(this.draft.intervals));
      } catch {
        return 'Check interval times';
      }
    },
  },
  async mounted() {
    this.api = new ProjectsApi();
    await this.refresh();
  },
  methods: {
    human(ns: string) {
      return humanDuration(BigInt(ns));
    },
    nodeName(id: string) {
      return this.snapshot.nodes.find(n => n.id === id)?.name || 'Unknown assignment';
    },
    showError(e) {
      this.error =
        e.response?.status === 412
          ? 'Another edit changed the workspace. Refresh, review current bookings and apply your draft again.'
          : e.response?.data?.message || e.message || 'The server rejected this change.';
    },
    async refresh() {
      if (this.pending) return;
      this.busy = true;
      this.error = '';
      try {
        this.snapshot = await this.api.load();
        const caps = (await getClient().req.get('/0/project-tracking/v1/capabilities')).data;
        this.unsupported = !caps.manual_entries;
        if (this.unsupported) {
          this.snapshot = null;
          return;
        }
        const buckets = await getClient().getBuckets();
        this.buckets = Object.entries(buckets).map(([id, b]) => ({ ...b, id }));
      } catch (e) {
        if (e.response?.status === 404) this.unsupported = true;
        else this.showError(e);
      } finally {
        this.busy = false;
      }
    },
    async loadLanes() {
      this.busy = true;
      this.error = '';
      this.notice = '';
      try {
        const from = this.fromInput + (this.fromInput.length === 16 ? ':00Z' : 'Z'),
          until = this.untilInput + (this.untilInput.length === 16 ? ':00Z' : 'Z'),
          windowDuration = instant(until) - instant(from);
        if (windowDuration <= 0n || windowDuration > 7n * 86400n * 1000000000n)
          throw new Error('Choose a positive window of up to seven days.');
        if (this.bucketIds.length > 8) throw new Error('Select at most eight source buckets.');
        const lanes = await Promise.all(
          this.bucketIds.map(async bucket => {
            const events = (
              await getClient().req.get(`/0/buckets/${encodeURIComponent(bucket)}/events`, {
                params: { start: from, end: until, limit: 5001 },
              })
            ).data;
            if (events.length > 5000)
              throw new Error(
                'A lane exceeds 5000 events. Narrow the window; no partial lane was loaded.'
              );
            const ends: bigint[] = [];
            const items = events
              .map((event, index) => ({
                event,
                span: eventSpan(event, from, until),
                key: bucket + ':' + index,
                bucket,
                label:
                  event.data?.title ||
                  event.data?.app ||
                  event.data?.file ||
                  'Activity (context unavailable)',
              }))
              .filter(i => i.span)
              .sort((a, b) => (instant(a.span.start) < instant(b.span.start) ? -1 : 1))
              .map(item => {
                let row = ends.findIndex(end => end <= instant(item.span.start));
                if (row < 0) row = ends.length;
                ends[row] = instant(item.span.end);
                return { ...item, row };
              });
            return { id: bucket, items, height: Math.max(38, ends.length * 32 + 6) };
          })
        );
        this.loadedFrom = from;
        this.loadedUntil = until;
        this.lanes = lanes;
        this.clearSelection();
      } catch (e) {
        this.showError(e);
      } finally {
        this.busy = false;
      }
    },
    blockStyle(span: Span, row: number) {
      const start = instant(this.loadedFrom),
        end = instant(this.loadedUntil),
        a = instant(span.start) > start ? instant(span.start) : start,
        b = instant(span.end) < end ? instant(span.end) : end;
      if (b <= a) return { display: 'none' };
      return {
        left: (Number(a - start) / Number(end - start)) * 100 + '%',
        width: (Number(b - a) / Number(end - start)) * 100 + '%',
        top: row * 32 + 3 + 'px',
      };
    },
    clearSelection() {
      this.selected = [];
      this.inspected = null;
    },
    toggle(item) {
      this.inspected = item;
      if (this.selected.includes(item.key))
        this.selected = this.selected.filter(k => k !== item.key);
      else if (this.selected.length < 1000) this.selected.push(item.key);
      else this.error = 'Select at most 1000 observations.';
    },
    begin(intervals: Span[], sources: any[]) {
      this.editing = false;
      this.taskId = uuid();
      this.taskName = '';
      this.taskParent = this.activeNodes[0]?.node.id || '';
      this.target = this.taskParent || 'new-task';
      this.draft = {
        id: uuid(),
        node_id: this.target,
        description: '',
        intervals: union(intervals),
        sources,
        deleted: false,
        duration_ns: '',
      };
      this.error = '';
      this.notice = '';
    },
    assignSelected() {
      this.begin(
        this.selectedItems.map(i => i.span),
        this.selectedItems.map(i => ({ bucket_id: i.bucket, event_id: i.event.id ?? null }))
      );
    },
    offline() {
      this.begin(
        [
          {
            start: this.loadedFrom,
            end: timestamp(instant(this.loadedFrom) + 3600n * 1000000000n),
          },
        ],
        []
      );
    },
    addSpan() {
      this.draft.intervals.push({
        start: this.loadedFrom,
        end: timestamp(instant(this.loadedFrom) + 3600n * 1000000000n),
      });
    },
    editEntry(entry: Entry) {
      this.draft = copy(entry);
      this.editing = true;
      this.target = entry.node_id;
      this.taskId = uuid();
      this.taskName = '';
      this.taskParent = entry.node_id;
      this.moveTo = '';
      this.splitAt = '';
      this.notice = '';
      this.error = '';
    },
    async transact(edit) {
      this.busy = true;
      this.error = '';
      this.notice = '';
      try {
        this.snapshot = await this.api.write(this.snapshot, 'bookings', edit);
        this.draft = null;
        this.selected = [];
        this.notice = 'Booked work saved.';
      } catch (e) {
        this.showError(e);
      } finally {
        this.pending = !!this.api.pending;
        this.busy = false;
      }
    },
    async save() {
      try {
        const entry = copy(this.draft);
        entry.intervals = union(entry.intervals);
        entry.duration_ns = duration(entry.intervals).toString();
        const task =
          this.target === 'new-task'
            ? newTask(this.snapshot, this.taskParent, this.taskName.trim(), this.taskId)
            : null;
        if (task && (!task.name || !task.parent_id))
          throw new Error('Choose a parent and task name. Create a project first if needed.');
        entry.node_id = task ? task.id : this.target;
        if (!entry.node_id) throw new Error('Choose a project or task.');
        await this.transact({ new_task: task, upsert: [entry], delete_ids: [] });
      } catch (e) {
        this.showError(e);
      }
    },
    async retry() {
      this.busy = true;
      this.error = '';
      try {
        this.snapshot = await this.api.retry();
        this.snapshot = await this.api.load();
        this.draft = null;
        this.selected = [];
        this.notice = 'Save confirmed.';
      } catch (e) {
        this.showError(e);
      } finally {
        this.pending = !!this.api.pending;
        this.busy = false;
      }
    },
    moveDraft() {
      try {
        this.draft = move(this.draft, this.moveTo);
      } catch (e) {
        this.showError(e);
      }
    },
    splitEntry() {
      try {
        const saved = this.snapshot.entries.find(e => e.id === this.draft.id);
        return this.transact({
          new_task: null,
          upsert: split(saved, this.splitAt),
          delete_ids: [saved.id],
        });
      } catch (e) {
        this.showError(e);
      }
    },
    deleteEntry() {
      return this.transact({ new_task: null, upsert: [], delete_ids: [this.draft.id] });
    },
  },
});
</script>

<style scoped>
.booking-timeline {
  overflow: auto;
  border: 1px solid #78828a;
}
.timeline-row {
  display: flex;
  min-width: 900px;
  border-bottom: 1px solid #78828a;
}
.lane-name {
  width: 180px;
  flex-shrink: 0;
  padding: 8px;
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}
.lane-track,
.lane-clock {
  position: relative;
  flex: 1;
  min-width: 700px;
  background: repeating-linear-gradient(
    90deg,
    transparent 0,
    transparent calc(25% - 1px),
    #78828a 25%
  );
}
.lane-clock {
  height: 30px;
}
.lane-clock span {
  position: absolute;
  font-size: 0.75rem;
}
.lane-clock span:last-child {
  transform: translateX(-100%);
}
.activity-block,
.entry-block {
  position: absolute;
  height: 26px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  min-width: 3px;
  border: 1px solid #226593;
  border-radius: 3px;
  background: #dcecf5;
  color: #142b3a !important;
  text-align: left;
  font-size: 0.75rem;
  padding: 2px;
}
.activity-block.chosen {
  background: #fbd577;
  border: 2px solid #936700;
}
.entry-block {
  background: #b6e8c7;
  border-color: #2c7047;
  color: #133a24 !important;
}
pre {
  max-height: 300px;
  overflow: auto;
}
label {
  font-weight: 500;
}
summary {
  cursor: pointer;
}
</style>
