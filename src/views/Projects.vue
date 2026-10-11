<template>
  <section>
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h3 class="mb-0">Projects &amp; tasks</h3>
      <button class="btn btn-outline-secondary" :disabled="busy || pending" @click="load">
        Reload
      </button>
    </div>
    <p class="text-muted">
      Organize work, billing and dated reporting IDs. Use Manual time booking to assign captured or
      offline work. Report exports are coming in the next stage.
    </p>
    <div v-if="unsupported" class="alert alert-info">
      Project tracking requires the extended Rust server. This server does not provide the module.
    </div>
    <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
    <div v-if="pending" class="alert alert-warning">
      The save response was interrupted. Retry the same change to find out whether it was saved.
      <button class="btn btn-sm btn-outline-dark ml-2" :disabled="busy" @click="retry">
        Retry save
      </button>
    </div>
    <p v-if="busy" role="status">Loading or saving…</p>
    <template v-if="snapshot">
      <details class="mb-4">
        <summary>
          Workspace settings — {{ snapshot.settings.name }} ·
          {{ snapshot.settings.reporting_timezone }}
        </summary>
        <form class="mt-3" @submit.prevent="saveSettings">
          <fieldset :disabled="busy || pending">
            <label
              >Workspace name<input
                v-model="settings.name"
                class="form-control"
                required
                maxlength="256"
            /></label>
            <label class="ml-md-3"
              >Reporting time zone<input
                v-model="settings.reporting_timezone"
                class="form-control"
                placeholder="Europe/Prague"
                required
            /></label>
            <button class="btn btn-primary ml-md-3">Save settings</button>
          </fieldset>
        </form>
      </details>
      <div class="row">
        <div class="col-lg-5 mb-4">
          <label class="w-100"
            >Search projects and tasks<input v-model="query" class="form-control" type="search"
          /></label>
          <label><input v-model="showArchived" type="checkbox" /> Show archived branches</label>
          <div class="mb-3">
            <button
              class="btn btn-primary mr-2"
              :disabled="busy || pending"
              @click="create('project')"
            >
              New project
            </button>
            <button
              class="btn btn-outline-primary"
              :disabled="busy || pending || !existing"
              @click="create('task')"
            >
              New task here
            </button>
          </div>
          <p v-if="!visible.length" class="text-muted">
            No matching projects. Create a project to begin.
          </p>
          <div class="list-group project-list">
            <button
              v-for="row in visible"
              :key="row.node.id"
              class="list-group-item list-group-item-action text-left"
              :class="{ active: edit && row.node.id === edit.id }"
              :disabled="busy || pending"
              :title="row.path"
              @click="select(row.node)"
            >
              <span :style="{ paddingLeft: Math.min(row.depth, 8) + 'rem' }"
                >{{ row.node.kind === 'task' ? '↳' : '▸' }} {{ row.node.name }}</span
              >
              <small class="d-block"
                >{{ row.node.case_id || 'No CaseId' }} · {{ row.node.billing
                }}<span v-if="row.archived"> · Archived</span></small
              >
            </button>
          </div>
        </div>
        <div class="col-lg-7">
          <form v-if="edit" @submit.prevent="saveNode">
            <fieldset :disabled="busy || pending">
              <h4>{{ existing ? 'Edit' : 'Create' }} {{ edit.kind }}</h4>
              <label class="w-100"
                >Name<input v-model="edit.name" class="form-control" required maxlength="1024"
              /></label>
              <label class="w-100"
                >Description<textarea
                  v-model="edit.description"
                  class="form-control"
                  maxlength="16384"
                />
              </label>
              <label class="w-100"
                >Parent<select v-model="edit.parent_id" class="form-control">
                  <option v-if="edit.kind === 'project'" :value="null">Top level</option>
                  <option v-for="node in parents" :key="node.id" :value="node.id">
                    {{ node.name }}
                  </option>
                </select></label
              >
              <label class="w-100"
                >CaseId (optional)<input
                  v-model="edit.case_id"
                  class="form-control"
                  maxlength="256"
              /></label>
              <label class="w-100"
                >Billing<select v-model="edit.billing" class="form-control">
                  <option value="inherited">Inherit</option>
                  <option value="tm">Time &amp; material</option>
                  <option value="fixed">Fixed price</option>
                  <option value="non_billable">Non-billable</option>
                </select></label
              >
              <div v-if="edit.billing === 'tm' || edit.billing === 'fixed'" class="row">
                <label class="col-4"
                  >Currency<input
                    v-model="edit.billing_terms.currency"
                    class="form-control"
                    placeholder="CZK"
                    maxlength="3"
                /></label>
                <label v-if="edit.billing === 'tm'" class="col-8"
                  >Hourly rate (optional)<input
                    v-model="edit.billing_terms.hourly_rate"
                    class="form-control"
                    inputmode="decimal"
                    placeholder="1500.00"
                /></label>
                <label v-else class="col-8"
                  >Fixed fee (optional)<input
                    v-model="edit.billing_terms.fixed_fee"
                    class="form-control"
                    inputmode="decimal"
                    placeholder="25000.00"
                /></label>
                <p class="col-12 text-muted small">
                  Use a decimal point. Fixed work still records time; hours do not automatically
                  create a T&amp;M charge.
                </p>
              </div>
              <label class="w-100"
                >Report work to<select v-model="reportTarget" class="form-control">
                  <option value="inherited">Inherit</option>
                  <option value="self">This node</option>
                  <option v-for="node in lineage" :key="node.id" :value="node.id">
                    {{ node.name }}
                  </option>
                </select></label
              >
              <label class="d-block"
                ><input v-model="edit.archived" type="checkbox" /> Archive this branch</label
              >
              <button class="btn btn-primary">Save {{ edit.kind }}</button>
            </fieldset>
          </form>
          <template v-if="edit && existing">
            <hr />
            <h4>Resolved policy</h4>
            <label
              >Work date<input
                v-model="workDate"
                class="form-control"
                type="date"
                @change="resolve"
            /></label>
            <p v-if="policy" class="small">
              Billing: {{ policy.policy.billing }} · Report target:
              {{ nodeName(policy.policy.reporting_target_id) }} · ActivityId:
              {{ policy.mapping ? policy.mapping.activity_id : 'Unmapped'
              }}<span v-if="policy.policy.effectively_archived"> · Archived branch</span>
            </p>
            <h4>Dated ActivityIds for this node</h4>
            <p class="text-muted small">
              Used when this node is the report target. Dates use the workspace time zone. The end
              date is exclusive. CaseId never substitutes for a missing ActivityId.
            </p>
            <ul class="list-unstyled">
              <li v-for="m in mappings" :key="m.id" class="mb-2">
                {{ m.activity_id }} · {{ m.valid_from }} → {{ m.valid_until || 'No end' }}
                <button
                  class="btn btn-sm btn-link"
                  :disabled="busy || pending"
                  @click="mapping = copy(m)"
                >
                  Edit
                </button>
                <button
                  class="btn btn-sm btn-link text-danger"
                  :disabled="busy || pending"
                  @click="removeMapping(m)"
                >
                  Remove
                </button>
              </li>
            </ul>
            <form @submit.prevent="saveMapping">
              <fieldset :disabled="busy || pending">
                <label class="w-100"
                  >ActivityId<input
                    v-model="mapping.activity_id"
                    class="form-control"
                    required
                    maxlength="256"
                /></label>
                <div class="row">
                  <label class="col-6"
                    >Valid from<input
                      v-model="mapping.valid_from"
                      class="form-control"
                      type="date"
                      required /></label
                  ><label class="col-6"
                    >Valid until (optional)<input
                      v-model="mapping.valid_until"
                      class="form-control"
                      type="date"
                  /></label>
                </div>
                <button class="btn btn-outline-primary">Save ActivityId</button>
                <button class="btn btn-link" type="button" @click="newMapping">New mapping</button>
              </fieldset>
            </form>
          </template>
        </div>
      </div>
    </template>
  </section>
</template>

<script lang="ts">
import Vue from 'vue';
import { v4 as uuid } from 'uuid';
import {
  ProjectsApi,
  ancestors,
  rows,
  workspaceDate,
  ProjectNode,
  Snapshot,
  Mapping,
  Settings,
} from '~/features/projects/api';

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
export default Vue.extend({
  data() {
    return {
      api: null as ProjectsApi | null,
      snapshot: null as Snapshot | null,
      settings: { name: '', reporting_timezone: 'UTC' } as Settings,
      edit: null as ProjectNode | null,
      reportTarget: 'inherited',
      mapping: {} as Mapping,
      policy: null as any,
      workDate: new Date().toISOString().slice(0, 10),
      query: '',
      showArchived: false,
      error: '',
      unsupported: false,
      busy: false,
      pending: false,
    };
  },
  computed: {
    visible() {
      return rows(this.snapshot.nodes, this.query, this.showArchived);
    },
    existing(): boolean {
      return !!this.edit && this.snapshot.nodes.some(n => n.id === this.edit.id);
    },
    lineage(): ProjectNode[] {
      return this.edit ? ancestors(this.snapshot.nodes, this.edit.parent_id) : [];
    },
    parents(): ProjectNode[] {
      return this.snapshot.nodes.filter(
        n =>
          n.id !== this.edit.id &&
          !ancestors(this.snapshot.nodes, n.parent_id).some(a => a.id === this.edit.id) &&
          (this.edit.kind === 'task' || n.kind === 'project')
      );
    },
    mappings(): Mapping[] {
      return this.snapshot.mappings.filter(m => m.owner_node_id === this.edit.id);
    },
  },
  mounted() {
    this.api = new ProjectsApi();
    this.load();
  },
  methods: {
    copy,
    nodeName(id: string): string {
      return this.snapshot.nodes.find(n => n.id === id)?.name || id;
    },
    accept(snapshot: Snapshot) {
      this.snapshot = snapshot;
      this.settings = copy(snapshot.settings);
      if (this.existing && this.mapping.owner_node_id !== this.edit.id) this.newMapping();
    },
    async load() {
      this.busy = true;
      this.error = '';
      this.unsupported = false;
      try {
        this.accept(await this.api.load());
        this.workDate = workspaceDate(this.snapshot.settings.reporting_timezone);
        await this.resolve();
      } catch (e) {
        if (e.response?.status === 404) this.unsupported = true;
        else this.showError(e);
      } finally {
        this.busy = false;
      }
    },
    showError(e) {
      const responseStatus = e.response?.status;
      this.error =
        responseStatus === 412
          ? 'Another edit changed the workspace. Reload, review the current data and apply your edit again.'
          : responseStatus === 422
          ? 'The change is invalid. Check parents, reporting target, billing terms and overlapping dates.'
          : responseStatus === 409
          ? 'The save identity conflicts with an earlier operation. Reload before making another change.'
          : e.response?.data?.message || e.message || 'The server could not complete this request.';
    },
    select(node: ProjectNode) {
      this.edit = copy(node);
      this.reportTarget =
        node.reporting.mode === 'ancestor' ? node.reporting.target_id : node.reporting.mode;
      this.policy = null;
      this.newMapping();
      this.resolve();
    },
    create(kind: 'project' | 'task') {
      const parent = this.edit?.id || null;
      this.edit = {
        id: uuid(),
        workspace_id: this.snapshot.workspace_id,
        parent_id: kind === 'task' ? parent : null,
        kind,
        name: '',
        description: '',
        case_id: null,
        archived: false,
        billing: 'inherited',
        billing_terms: { currency: null, hourly_rate: null, fixed_fee: null },
        reporting: { mode: 'inherited' },
      };
      this.reportTarget = 'inherited';
      this.policy = null;
    },
    async change(suffix: string, data: unknown, method: 'put' | 'delete' = 'put') {
      this.busy = true;
      this.error = '';
      try {
        this.accept(await this.api.write(this.snapshot, suffix, data, method));
        await this.resolve();
      } catch (e) {
        this.showError(e);
      } finally {
        this.pending = !!this.api.pending;
        this.busy = false;
      }
    },
    async retry() {
      this.busy = true;
      this.error = '';
      try {
        this.accept(await this.api.retry());
        this.accept(await this.api.load());
        await this.resolve();
      } catch (e) {
        this.showError(e);
      } finally {
        this.pending = !!this.api.pending;
        this.busy = false;
      }
    },
    saveSettings() {
      return this.change('settings', this.settings);
    },
    saveNode() {
      const node = copy(this.edit);
      node.case_id = node.case_id?.trim() || null;
      node.reporting =
        this.reportTarget === 'inherited' || this.reportTarget === 'self'
          ? { mode: this.reportTarget }
          : { mode: 'ancestor', target_id: this.reportTarget };
      node.billing_terms = {
        currency: ['tm', 'fixed'].includes(node.billing)
          ? node.billing_terms.currency?.trim() || null
          : null,
        hourly_rate: node.billing === 'tm' ? node.billing_terms.hourly_rate?.trim() || null : null,
        fixed_fee: node.billing === 'fixed' ? node.billing_terms.fixed_fee?.trim() || null : null,
      };
      return this.change(`nodes/${node.id}`, node);
    },
    newMapping() {
      this.mapping = {
        id: uuid(),
        owner_node_id: this.edit.id,
        activity_id: '',
        valid_from: this.workDate,
        valid_until: null,
      };
    },
    saveMapping() {
      const m = copy(this.mapping);
      m.valid_until = m.valid_until || null;
      return this.change(`activity-id-mappings/${m.id}`, m);
    },
    removeMapping(m: Mapping) {
      return this.change(`activity-id-mappings/${m.id}`, null, 'delete');
    },
    async resolve() {
      if (!this.existing || !this.workDate) return;
      const selected = this.edit.id;
      const date = this.workDate;
      try {
        const policy = await this.api.resolve(this.snapshot, selected, date);
        if (this.edit?.id === selected && this.workDate === date) this.policy = policy;
      } catch (e) {
        this.showError(e);
      }
    },
  },
});
</script>

<style scoped>
.project-list {
  max-height: 65vh;
  overflow: auto;
}
label {
  font-weight: 500;
}
summary {
  cursor: pointer;
}
</style>
