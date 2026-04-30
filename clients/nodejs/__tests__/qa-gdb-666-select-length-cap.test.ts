/**
 * QA adversarial tests for GDB-666: select length cap prevents memory DoS.
 *
 * The fix relies on renderSelect (from GDB-665) enforcing:
 *   - 64-char max per identifier
 *   - 1000-item max per array
 *   - Rejection of raw strings (non-"*")
 *
 * These tests verify those caps hold across all algorithm builders and
 * buildShortestPath, with adversarial boundary values and type coercion.
 */
import { describe, it, expect } from 'vitest';
import {
  buildPagerank,
  buildBetweennessCentrality,
  buildConnectedComponents,
  buildLouvain,
  buildDegreeCentrality,
  buildClosenessCentrality,
  buildEigenvectorCentrality,
  buildHarmonicCentrality,
  buildClusteringCoefficient,
  buildTriangleCount,
  buildStronglyConnectedComponents,
  buildShortestPath,
} from '../src/query-builders';

// ---------------------------------------------------------------------------
// Helper: all algorithm builders with a select option
// ---------------------------------------------------------------------------

const algorithmBuilders = [
  { name: 'buildPagerank', fn: (opts: { select: unknown }) => buildPagerank('e', opts as any) },
  { name: 'buildBetweennessCentrality', fn: (opts: { select: unknown }) => buildBetweennessCentrality('e', opts as any) },
  { name: 'buildConnectedComponents', fn: (opts: { select: unknown }) => buildConnectedComponents('e', opts as any) },
  { name: 'buildLouvain', fn: (opts: { select: unknown }) => buildLouvain('e', opts as any) },
  { name: 'buildDegreeCentrality', fn: (opts: { select: unknown }) => buildDegreeCentrality('e', opts as any) },
  { name: 'buildClosenessCentrality', fn: (opts: { select: unknown }) => buildClosenessCentrality('e', opts as any) },
  { name: 'buildEigenvectorCentrality', fn: (opts: { select: unknown }) => buildEigenvectorCentrality('e', opts as any) },
  { name: 'buildHarmonicCentrality', fn: (opts: { select: unknown }) => buildHarmonicCentrality('e', opts as any) },
  { name: 'buildClusteringCoefficient', fn: (opts: { select: unknown }) => buildClusteringCoefficient('e', opts as any) },
  { name: 'buildTriangleCount', fn: (opts: { select: unknown }) => buildTriangleCount('e', opts as any) },
  { name: 'buildStronglyConnectedComponents', fn: (opts: { select: unknown }) => buildStronglyConnectedComponents('e', opts as any) },
];

const shortestPathWithSelect = (select: unknown) =>
  buildShortestPath('e', 't', 1, 't', 2, { select } as any);

// ---------------------------------------------------------------------------
// 1. 1MB string as select -- must be rejected
// ---------------------------------------------------------------------------

describe('QA GDB-666: 1MB string select rejection', () => {
  it('should reject a 1MB raw string via buildPagerank', () => {
    const megabyte = 'a'.repeat(1_000_000);
    expect(() => buildPagerank('e', { select: megabyte as any })).toThrow(TypeError);
  });

  it('should reject a 1MB raw string via buildShortestPath', () => {
    const megabyte = 'a'.repeat(1_000_000);
    expect(() => shortestPathWithSelect(megabyte)).toThrow(TypeError);
  });

  it.each(algorithmBuilders)(
    'should reject 1MB string in $name',
    ({ fn }) => {
      expect(() => fn({ select: 'x'.repeat(1_000_000) })).toThrow(TypeError);
    },
  );
});

// ---------------------------------------------------------------------------
// 2. Very long individual identifiers (65+ chars) -- must be rejected
// ---------------------------------------------------------------------------

describe('QA GDB-666: long identifier rejection', () => {
  it('should reject a 65-char identifier in an array', () => {
    expect(() => buildPagerank('e', { select: ['a'.repeat(65)] })).toThrow(RangeError);
  });

  it('should reject a 100-char identifier', () => {
    expect(() => buildPagerank('e', { select: ['x'.repeat(100)] })).toThrow(RangeError);
  });

  it('should reject a 10000-char identifier', () => {
    expect(() => buildPagerank('e', { select: ['z'.repeat(10_000)] })).toThrow(RangeError);
  });

  it('should reject 65-char identifier via buildShortestPath', () => {
    expect(() => shortestPathWithSelect(['a'.repeat(65)])).toThrow(RangeError);
  });

  it.each(algorithmBuilders)(
    'should reject 65-char identifier in $name',
    ({ fn }) => {
      expect(() => fn({ select: ['a'.repeat(65)] })).toThrow(RangeError);
    },
  );
});

// ---------------------------------------------------------------------------
// 3. 1001+ item arrays -- must be rejected
// ---------------------------------------------------------------------------

describe('QA GDB-666: oversized array rejection', () => {
  it('should reject 1001-item array via buildPagerank', () => {
    const cols = Array.from({ length: 1001 }, (_, i) => `c${i}`);
    expect(() => buildPagerank('e', { select: cols })).toThrow(RangeError);
  });

  it('should reject 5000-item array', () => {
    const cols = Array.from({ length: 5000 }, (_, i) => `c${i}`);
    expect(() => buildPagerank('e', { select: cols })).toThrow(RangeError);
  });

  it('should reject 1001-item array via buildShortestPath', () => {
    const cols = Array.from({ length: 1001 }, (_, i) => `c${i}`);
    expect(() => shortestPathWithSelect(cols)).toThrow(RangeError);
  });

  it.each(algorithmBuilders)(
    'should reject 1001-item array in $name',
    ({ fn }) => {
      const cols = Array.from({ length: 1001 }, (_, i) => `c${i}`);
      expect(() => fn({ select: cols })).toThrow(RangeError);
    },
  );
});

// ---------------------------------------------------------------------------
// 4. Boundary: exactly 64-char identifier should succeed
// ---------------------------------------------------------------------------

describe('QA GDB-666: 64-char identifier boundary (pass)', () => {
  it('should accept exactly 64-char identifier via buildPagerank', () => {
    const ident = 'a'.repeat(64);
    const q = buildPagerank('e', { select: [ident] });
    expect(q.text).toContain(`"${ident}"`);
  });

  it('should accept exactly 64-char identifier via buildShortestPath', () => {
    const ident = 'a'.repeat(64);
    const q = buildShortestPath('e', 't', 1, 't', 2, { select: [ident] });
    expect(q.text).toContain(`"${ident}"`);
  });

  it.each(algorithmBuilders)(
    'should accept 64-char identifier in $name',
    ({ fn }) => {
      const ident = 'a'.repeat(64);
      const q = fn({ select: [ident] });
      expect(q.text).toContain(`"${ident}"`);
    },
  );
});

// ---------------------------------------------------------------------------
// 5. Boundary: exactly 1000-item array should succeed
// ---------------------------------------------------------------------------

describe('QA GDB-666: 1000-item array boundary (pass)', () => {
  it('should accept exactly 1000 items via buildPagerank', () => {
    const cols = Array.from({ length: 1000 }, (_, i) => `c${i}`);
    const q = buildPagerank('e', { select: cols });
    expect(q.text).toContain('FROM pagerank');
    // Verify first and last column present
    expect(q.text).toContain('"c0"');
    expect(q.text).toContain('"c999"');
  });

  it('should accept exactly 1000 items via buildShortestPath', () => {
    const cols = Array.from({ length: 1000 }, (_, i) => `c${i}`);
    const q = buildShortestPath('e', 't', 1, 't', 2, { select: cols });
    expect(q.text).toContain('"c0"');
    expect(q.text).toContain('"c999"');
  });
});

// ---------------------------------------------------------------------------
// 6. All algorithm builders consistently protected
// ---------------------------------------------------------------------------

describe('QA GDB-666: consistent protection across all builders', () => {
  // Each builder with a 64-char boundary + 1 should throw RangeError
  it.each(algorithmBuilders)(
    '$name rejects 65-char identifier with RangeError',
    ({ fn }) => {
      expect(() => fn({ select: ['a'.repeat(65)] })).toThrow(RangeError);
    },
  );

  // Each builder should accept "*" as select
  it.each(algorithmBuilders)(
    '$name accepts literal "*" select',
    ({ fn }) => {
      const q = fn({ select: '*' });
      expect(q.text).toMatch(/SELECT \*/);
    },
  );

  // Each builder should accept undefined/null select (defaults to "*")
  it.each(algorithmBuilders)(
    '$name defaults to "*" when select is undefined',
    ({ fn }) => {
      // The wrapper passes select through; undefined should hit the ?? '*' default
      // in each builder. We test by constructing without select option.
      const q = fn({ select: undefined as any });
      expect(q.text).toMatch(/SELECT \*/);
    },
  );

  it.each(algorithmBuilders)(
    '$name defaults to "*" when select is null',
    ({ fn }) => {
      const q = fn({ select: null });
      expect(q.text).toMatch(/SELECT \*/);
    },
  );
});

// ---------------------------------------------------------------------------
// 7. buildShortestPath select also protected
// ---------------------------------------------------------------------------

describe('QA GDB-666: buildShortestPath select protection', () => {
  it('should reject raw string select', () => {
    expect(() => shortestPathWithSelect('node_id, score')).toThrow(TypeError);
  });

  it('should reject 65-char identifier in array', () => {
    expect(() => shortestPathWithSelect(['a'.repeat(65)])).toThrow(RangeError);
  });

  it('should reject 1001-item array', () => {
    const cols = Array.from({ length: 1001 }, (_, i) => `c${i}`);
    expect(() => shortestPathWithSelect(cols)).toThrow(RangeError);
  });

  it('should accept valid array select', () => {
    const q = buildShortestPath('e', 't', 1, 't', 2, { select: ['node_id', 'cost'] });
    expect(q.text).toContain('"node_id"');
    expect(q.text).toContain('"cost"');
  });

  it('should accept "*" select', () => {
    const q = buildShortestPath('e', 't', 1, 't', 2, { select: '*' });
    expect(q.text).toMatch(/SELECT \* FROM/);
  });

  it('should default to "*" when select is omitted', () => {
    const q = buildShortestPath('e', 't', 1, 't', 2);
    expect(q.text).toMatch(/SELECT \* FROM/);
  });
});

// ---------------------------------------------------------------------------
// 8. Raw string select (not array) should be rejected
// ---------------------------------------------------------------------------

describe('QA GDB-666: raw string rejection', () => {
  it('should reject a short raw string that is not "*"', () => {
    expect(() => buildPagerank('e', { select: 'node_id' as any })).toThrow(TypeError);
  });

  it('should reject "* " (star with trailing space)', () => {
    expect(() => buildPagerank('e', { select: '* ' as any })).toThrow(TypeError);
  });

  it('should reject " *" (star with leading space)', () => {
    expect(() => buildPagerank('e', { select: ' *' as any })).toThrow(TypeError);
  });

  it('should reject empty string', () => {
    expect(() => buildPagerank('e', { select: '' as any })).toThrow(TypeError);
  });

  it('should reject SQL injection via raw string', () => {
    expect(() =>
      buildPagerank('e', { select: '*, 1; DROP TABLE users--' as any }),
    ).toThrow(TypeError);
  });

  it('should reject numeric select', () => {
    expect(() => buildPagerank('e', { select: 42 as any })).toThrow(TypeError);
  });

  it('should reject boolean select', () => {
    expect(() => buildPagerank('e', { select: true as any })).toThrow(TypeError);
  });

  it('should reject object select', () => {
    expect(() => buildPagerank('e', { select: { col: 'x' } as any })).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// 9. Validation short-circuits before allocating large strings
// ---------------------------------------------------------------------------

describe('QA GDB-666: short-circuit validation (no large string allocation)', () => {
  it('should reject 1MB string without constructing SQL text', () => {
    const start = performance.now();
    expect(() => buildPagerank('e', { select: 'x'.repeat(1_000_000) as any })).toThrow(TypeError);
    const elapsed = performance.now() - start;
    // Rejection should be near-instant (< 50ms). If it took longer, the
    // validation is not short-circuiting and is doing unnecessary work.
    expect(elapsed).toBeLessThan(50);
  });

  it('should reject a 1001-item array quickly', () => {
    const cols = Array.from({ length: 1001 }, (_, i) => `c${i}`);
    const start = performance.now();
    expect(() => buildPagerank('e', { select: cols })).toThrow(RangeError);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it('should reject 65-char identifier without scanning the whole array', () => {
    // Array where only the first element is invalid
    const cols = ['a'.repeat(65), ...Array.from({ length: 999 }, (_, i) => `c${i}`)];
    const start = performance.now();
    expect(() => buildPagerank('e', { select: cols })).toThrow(RangeError);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// Additional adversarial: edge cases in array contents
// ---------------------------------------------------------------------------

describe('QA GDB-666: adversarial array contents', () => {
  it('should reject array containing null', () => {
    expect(() => buildPagerank('e', { select: [null] as any })).toThrow(TypeError);
  });

  it('should reject array containing undefined', () => {
    expect(() => buildPagerank('e', { select: [undefined] as any })).toThrow(TypeError);
  });

  it('should reject array containing number', () => {
    expect(() => buildPagerank('e', { select: [42] as any })).toThrow(TypeError);
  });

  it('should reject array containing empty string', () => {
    expect(() => buildPagerank('e', { select: [''] })).toThrow(TypeError);
  });

  it('should reject array with valid + invalid identifiers (catches all items)', () => {
    expect(() =>
      buildPagerank('e', { select: ['node_id', 'a'.repeat(65)] }),
    ).toThrow(RangeError);
  });

  it('should reject empty array', () => {
    expect(() => buildPagerank('e', { select: [] })).toThrow(TypeError);
  });

  it('should reject identifier with special characters', () => {
    expect(() => buildPagerank('e', { select: ['col; DROP TABLE x'] })).toThrow(TypeError);
  });

  it('should reject identifier starting with digit', () => {
    expect(() => buildPagerank('e', { select: ['1col'] })).toThrow(TypeError);
  });

  it('should reject identifier with unicode', () => {
    expect(() => buildPagerank('e', { select: ['écol'] })).toThrow(TypeError);
  });

  it('should reject identifier with newline', () => {
    expect(() => buildPagerank('e', { select: ['col\n'] })).toThrow(TypeError);
  });
});
