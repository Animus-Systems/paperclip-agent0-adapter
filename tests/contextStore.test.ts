import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ContextStore } from '../src/contextStore';

function createDbPath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'paperclip-a0-'));
  return path.join(directory, 'contexts.sqlite');
}

describe('ContextStore', () => {
  it('creates, reads, updates, lists, and deletes context mappings', () => {
    const store = new ContextStore(createDbPath());

    expect(store.getContextId('missing-agent')).toBeNull();

    store.saveContextId('agent-1', 'ctx-1', 'company-a');
    expect(store.getContextId('agent-1')).toBe('ctx-1');

    store.saveContextId('agent-1', 'ctx-2', 'company-b');
    expect(store.getContextId('agent-1')).toBe('ctx-2');

    const rows = store.listAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.company_id).toBe('company-b');

    store.deleteContextId('agent-1');
    expect(store.getContextId('agent-1')).toBeNull();

    store.close();
  });
});
