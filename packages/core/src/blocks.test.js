import { describe, expect, it } from 'vitest';
import { Block, BLOCK_TYPES } from './blocks.js';

describe('Block', () => {
  it('accepts a minimal todo block and fills defaults', () => {
    const block = Block.parse({ id: 'b1', type: 'todo', parentId: null, order: 'a0' });
    expect(block.props).toEqual({});
    expect(block.content).toBe('');
  });

  it('rejects unknown block types', () => {
    expect(() => Block.parse({ id: 'b1', type: 'nope', parentId: null, order: 'a0' })).toThrow();
  });

  it('covers the v0.1 editor blocks', () => {
    expect(BLOCK_TYPES).toContain('todo');
    expect(BLOCK_TYPES).toContain('code');
  });
});
