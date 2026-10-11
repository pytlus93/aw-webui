import { shallowMount } from '@vue/test-utils';
import Projects from '../../src/views/Projects.vue';

const root = {
  id: 'root',
  workspace_id: 'workspace',
  parent_id: null,
  kind: 'project',
  name: 'Synthetic',
  description: '',
  case_id: null,
  archived: false,
  billing: 'inherited',
  billing_terms: { currency: null, hourly_rate: null, fixed_fee: null },
  reporting: { mode: 'self' },
};
const mockSnapshot = {
  workspace_id: 'workspace',
  revision: 1,
  settings: { name: 'Projects', reporting_timezone: 'UTC' },
  nodes: [root],
  mappings: [],
};
const mockResolve = jest.fn().mockResolvedValue({
  policy: { billing: 'non_billable', reporting_target_id: 'root' },
  mapping: null,
});
const mockWrite = jest.fn();
jest.mock('../../src/features/projects/api', () => {
  const actual = jest.requireActual('../../src/features/projects/api');
  return {
    ...actual,
    ProjectsApi: jest.fn().mockImplementation(() => ({
      load: async () => mockSnapshot,
      resolve: mockResolve,
      write: mockWrite,
      pending: null,
    })),
  };
});
const flush = () => new Promise(r => setTimeout(r, 0));

test('creates a child task and sends a decimal string without inherited terms', async () => {
  const view = shallowMount(Projects);
  await flush();
  view.vm.select(root);
  view.vm.create('task');
  expect(view.vm.edit.parent_id).toBe('root');
  view.vm.edit.name = 'Synthetic child';
  view.vm.edit.billing = 'tm';
  view.vm.edit.billing_terms.currency = 'CZK';
  view.vm.edit.billing_terms.hourly_rate = '1500.123456';
  mockWrite.mockImplementation(async (_snapshot, _path, node) => ({
    ...mockSnapshot,
    revision: 2,
    nodes: [root, node],
  }));
  await view.vm.saveNode();
  const node = mockWrite.mock.calls[0][2];
  expect(node.billing_terms.hourly_rate).toBe('1500.123456');
  expect(node.parent_id).toBe('root');
  expect(view.vm.existing).toBe(true);
  expect(view.vm.mapping.owner_node_id).toBe(node.id);
  expect(view.vm.mapping.valid_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  view.vm.edit.billing = 'inherited';
  await view.vm.saveNode();
  expect(mockWrite.mock.calls[1][2].billing_terms).toEqual({
    currency: null,
    hourly_rate: null,
    fixed_fee: null,
  });
  view.destroy();
});

test('preserves the draft on stale save and offers reload', async () => {
  const view = shallowMount(Projects);
  await flush();
  view.vm.select(root);
  view.vm.edit.name = 'Draft';
  mockWrite.mockRejectedValueOnce({ response: { status: 412 } });
  await view.vm.saveNode();
  expect(view.vm.edit.name).toBe('Draft');
  expect(view.vm.snapshot.nodes[0].name).toBe('Synthetic');
  expect(view.text()).toContain('Another edit changed the workspace');
  view.destroy();
});
