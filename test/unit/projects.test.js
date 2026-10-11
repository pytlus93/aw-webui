import { ProjectsApi, rows, workspaceDate } from '../../src/features/projects/api';

jest.mock('../../src/util/awclient', () => ({ getClient: jest.fn() }));

const snapshot = { workspace_id: 'synthetic', revision: 4 };
describe('project transport', () => {
  test('a lost response retries the original body, key and precondition', async () => {
    const request = {
      request: jest
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({ data: { ...snapshot, revision: 5 } }),
    };
    const api = new ProjectsApi(request);
    const body = { name: 'Synthetic' };
    await expect(api.write(snapshot, 'settings', body)).rejects.toThrow('timeout');
    const operation = JSON.parse(JSON.stringify(api.pending));
    body.name = 'Changed after timeout';
    await expect(api.write(snapshot, 'settings', body)).rejects.toThrow('pending');
    const saved = await api.retry();
    expect(saved.revision).toBe(5);
    expect(request.request.mock.calls[1][0]).toEqual(operation);
    expect(operation.headers['If-Match']).toBe('"4"');
    expect(operation.data.name).toBe('Synthetic');
    expect(api.pending).toBeNull();
  });

  test('stale edits are rejected without automatic retry', async () => {
    const rejection = { response: { status: 412 } };
    const request = { request: jest.fn().mockRejectedValue(rejection) };
    const api = new ProjectsApi(request);
    await expect(api.write(snapshot, 'settings', {})).rejects.toBe(rejection);
    expect(api.pending).toBeNull();
    expect(request.request).toHaveBeenCalledTimes(1);
  });

  test('checks capabilities before loading authoritative data', async () => {
    const request = {
      get: jest
        .fn()
        .mockResolvedValueOnce({ data: { api_version: 1, features: ['workspace_settings'] } })
        .mockResolvedValueOnce({ data: snapshot }),
    };
    expect(await new ProjectsApi(request).load()).toEqual(snapshot);
    expect(request.get.mock.calls[1][0]).toBe('/0/project-tracking/v1/workspace');
  });
});

test('search preserves paths and ancestor archive applies to descendants', () => {
  const nodes = [
    { id: 'root', parent_id: null, name: 'Synthetic customer', archived: true },
    { id: 'child', parent_id: 'root', name: 'Deployment', archived: false },
    { id: 'other', parent_id: null, name: 'Other', archived: false },
  ];
  expect(rows(nodes, '', false).map(r => r.node.id)).toEqual(['other']);
  const found = rows(nodes, 'deployment', true);
  expect(found).toHaveLength(1);
  expect(found[0].path).toBe('Synthetic customer / Deployment');
  expect(found[0].archived).toBe(true);
});

test('work dates use the reporting zone across a UTC midnight boundary', () => {
  const instant = new Date('2026-10-10T22:30:00Z');
  expect(workspaceDate('Europe/Prague', instant)).toBe('2026-10-11');
  expect(workspaceDate('America/New_York', instant)).toBe('2026-10-10');
});
