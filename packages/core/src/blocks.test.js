import { describe, expect, it } from 'vitest';
import { Block, BLOCK_TYPES, BlockBatch, plainText } from './blocks.js';

describe('Block', () => {
  it('accepts a minimal todo block and fills defaults', () => {
    const block = Block.parse({ id: 'b1', type: 'todo', parentId: null, order: 'a0' });
    expect(block.props).toEqual({});
    expect(block.content).toEqual([]);
  });

  it('keeps rich text runs as given', () => {
    const content = [{ type: 'text', text: 'hi', styles: { bold: true } }];
    expect(Block.parse({ id: 'b1', type: 'paragraph', parentId: null, order: 'a0', content }).content).toEqual(content);
  });

  it('rejects unknown block types', () => {
    expect(() => Block.parse({ id: 'b1', type: 'nope', parentId: null, order: 'a0' })).toThrow();
  });

  it('covers the v0.1 editor blocks', () => {
    expect(BLOCK_TYPES).toContain('todo');
    expect(BLOCK_TYPES).toContain('code');
  });
});

describe('BlockBatch', () => {
  it('defaults to an empty batch', () => {
    expect(BlockBatch.parse({})).toEqual({ upserts: [], deletes: [] });
  });
});

describe('plainText', () => {
  it('flattens text and links', () => {
    const content = [
      { type: 'text', text: 'see ' },
      { type: 'link', href: 'https://x.dev', content: [{ type: 'text', text: 'here' }] },
    ];
    expect(plainText(content)).toBe('see here');
  });

  it('writes date mentions as ISO dates', () => {
    expect(plainText([{ type: 'text', text: 'due ' }, { type: 'date', props: { date: '2026-10-05' } }])).toBe('due 2026-10-05');
  });
});
