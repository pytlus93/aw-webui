import { shallowMount } from '@vue/test-utils';
import Booking from '../../src/views/ProjectBooking.vue';

const mockNode = {
  id: 'root',
  parent_id: null,
  kind: 'project',
  name: 'Synthetic',
  archived: false,
};
const mockSnapshot = {
  workspace_id: 'workspace',
  revision: 1,
  nodes: [mockNode],
  entries: [],
  settings: { name: 'Projects', reporting_timezone: 'UTC' },
  mappings: [],
};
const mockWrite = jest.fn();
jest.mock('../../src/features/projects/api', () => {
  const actual = jest.requireActual('../../src/features/projects/api');
  return {
    ...actual,
    ProjectsApi: jest.fn().mockImplementation(() => ({
      load: async () => mockSnapshot,
      write: mockWrite,
      pending: null,
    })),
  };
});
jest.mock('../../src/util/awclient', () => ({
  getClient: () => ({
    getBuckets: async () => ({}),
    req: { get: async () => ({ data: { manual_entries: true } }) },
  }),
}));
const flush = () => new Promise(r => setTimeout(r, 0));

test('assignment creates a task and its entry in one operation without source data', async () => {
  const view = shallowMount(Booking, { stubs: ['router-link'] });
  await flush();
  view.vm.lanes = [
    {
      items: [
        {
          key: 'a',
          bucket: 'synthetic-bucket',
          event: { id: 3, data: { sql: 'private' } },
          span: { start: '2026-10-11T10:00:00Z', end: '2026-10-11T10:15:00Z' },
        },
      ],
    },
  ];
  view.vm.selected = ['a'];
  view.vm.assignSelected();
  view.vm.target = 'new-task';
  view.vm.taskParent = 'root';
  view.vm.taskName = 'Deployment';
  mockWrite.mockImplementation(async (_snapshot, _path, edit) => ({
    ...mockSnapshot,
    revision: 2,
    nodes: [mockNode, edit.new_task],
    entries: edit.upsert,
  }));
  await view.vm.save();
  expect(mockWrite).toHaveBeenCalledTimes(1);
  const edit = mockWrite.mock.calls[0][2];
  expect(edit.new_task.name).toBe('Deployment');
  expect(edit.upsert[0].node_id).toBe(edit.new_task.id);
  expect(edit.upsert[0].sources).toEqual([{ bucket_id: 'synthetic-bucket', event_id: 3 }]);
  expect(JSON.stringify(edit)).not.toContain('private');
  expect(view.vm.draft).toBeNull();
  view.destroy();
});

test('overlap rejection preserves the assignment and new-task draft', async () => {
  const view = shallowMount(Booking, { stubs: ['router-link'] });
  await flush();
  view.vm.offline();
  view.vm.target = 'new-task';
  view.vm.taskName = 'Draft task';
  const id = view.vm.taskId;
  mockWrite.mockRejectedValueOnce({
    response: { status: 422, data: { message: 'booked time overlaps' } },
  });
  await view.vm.save();
  expect(view.vm.taskId).toBe(id);
  expect(view.vm.taskName).toBe('Draft task');
  expect(view.vm.snapshot.entries).toHaveLength(0);
  expect(view.text()).toContain('booked time overlaps');
  view.destroy();
});
