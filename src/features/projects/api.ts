import { getClient } from '~/util/awclient';
import { v4 as uuid } from 'uuid';
import type { Entry } from './booking';

export type Billing = 'inherited' | 'tm' | 'fixed' | 'non_billable';
export interface ProjectNode {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  kind: 'project' | 'task';
  name: string;
  description: string;
  case_id: string | null;
  archived: boolean;
  billing: Billing;
  billing_terms: { currency: string | null; hourly_rate: string | null; fixed_fee: string | null };
  reporting: { mode: 'inherited' | 'self' | 'ancestor'; target_id?: string };
}
export interface Mapping {
  id: string;
  owner_node_id: string;
  valid_from: string;
  valid_until: string | null;
  activity_id: string;
}
export interface Settings {
  name: string;
  reporting_timezone: string;
}
export interface Snapshot {
  workspace_id: string;
  revision: number;
  settings: Settings;
  nodes: ProjectNode[];
  mappings: Mapping[];
  entries?: Entry[];
}

export function workspaceDate(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (name: string) => parts.find(p => p.type === name).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
interface Operation {
  method: 'put' | 'delete';
  url: string;
  data: unknown;
  headers: { 'If-Match': string; 'Idempotency-Key': string };
}
const base = '/0/project-tracking/v1';

// Keep the exact operation after ambiguous transport failures. No automatic
// retry, no browser-persisted entity data, and no new key until it is resolved.
export class ProjectsApi {
  pending: Operation | null = null;
  constructor(private request = getClient().req) {}

  async load(): Promise<Snapshot> {
    const capabilities = (await this.request.get(`${base}/capabilities`)).data;
    if (capabilities.api_version !== 1 || !capabilities.features.includes('workspace_settings')) {
      throw new Error('This server needs the current project tracking module.');
    }
    return (await this.request.get(`${base}/workspace`)).data;
  }

  async resolve(snapshot: Snapshot, node: string, date: string) {
    return (
      await this.request.get(
        `${base}/workspaces/${snapshot.workspace_id}/nodes/${node}/resolved-policy`,
        {
          params: { work_date: date },
        }
      )
    ).data;
  }

  async write(
    snapshot: Snapshot,
    suffix: string,
    data: unknown,
    method: 'put' | 'delete' = 'put'
  ): Promise<Snapshot> {
    if (this.pending) throw new Error('Resolve the pending save before making another change.');
    this.pending = {
      method,
      url: `${base}/workspaces/${snapshot.workspace_id}/${suffix}`,
      data: JSON.parse(JSON.stringify(data)),
      headers: { 'If-Match': `"${snapshot.revision}"`, 'Idempotency-Key': uuid() },
    };
    return this.retry();
  }

  async retry(): Promise<Snapshot> {
    if (!this.pending) throw new Error('No pending save.');
    try {
      const response = await this.request.request<Snapshot>(this.pending);
      this.pending = null;
      return response.data;
    } catch (error) {
      // A received rejection is definitive. A timeout/connection failure may
      // have committed, so keep the original identity and revision for replay.
      if (error.response && error.response.status < 500) this.pending = null;
      throw error;
    }
  }
}

export function ancestors(nodes: ProjectNode[], parent: string | null): ProjectNode[] {
  const result: ProjectNode[] = [];
  const seen = new Set<string>();
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const node = nodes.find(n => n.id === parent);
    if (!node) break;
    result.unshift(node);
    parent = node.parent_id;
  }
  return result;
}

export function rows(nodes: ProjectNode[], query: string, showArchived: boolean) {
  const lookup = new Map(nodes.map(n => [n.id, n]));
  const result: { node: ProjectNode; depth: number; path: string; archived: boolean }[] = [];
  function visit(parent: string | null, depth: number, inheritedArchive: boolean, path: string[]) {
    nodes
      .filter(n => n.parent_id === parent)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(node => {
        const archived = inheritedArchive || node.archived;
        const names = [...path, node.name];
        if (
          (!archived || showArchived) &&
          `${names.join(' / ')} ${node.case_id || ''}`.toLowerCase().includes(query.toLowerCase())
        ) {
          result.push({ node, depth, path: names.join(' / '), archived });
        }
        if (depth < 128 && lookup.has(node.id)) visit(node.id, depth + 1, archived, names);
      });
  }
  visit(null, 0, false, []);
  return result;
}
