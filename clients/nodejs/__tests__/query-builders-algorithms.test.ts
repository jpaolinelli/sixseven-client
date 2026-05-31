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
} from '../src/query-builders';
import * as pkg from '../src/index';

// ---------------------------------------------------------------------------
// buildPagerank
// ---------------------------------------------------------------------------

describe('buildPagerank', () => {
  it('builds a pagerank query with default damping and iterations', () => {
    const q = buildPagerank('knows');
    expect(q.text).toBe('SELECT * FROM pagerank($1, $2, $3)');
    expect(q.values).toEqual(['knows', 0.85, 20]);
  });

  it('respects custom damping and iterations', () => {
    const q = buildPagerank('follows', { damping: 0.5, iterations: 50 });
    expect(q.values).toEqual(['follows', 0.5, 50]);
  });

  it('respects a custom select projection (array of identifiers)', () => {
    const q = buildPagerank('knows', { select: ['node_id', 'score'] });
    expect(q.text).toBe(
      'SELECT "node_id", "score" FROM pagerank($1, $2, $3)',
    );
  });

  it('accepts the literal "*" select', () => {
    const q = buildPagerank('knows', { select: '*' });
    expect(q.text).toBe('SELECT * FROM pagerank($1, $2, $3)');
  });

  it('rejects empty edge type', () => {
    expect(() => buildPagerank('')).toThrow(/edgeType/);
  });

  it('rejects whitespace-only edge type', () => {
    expect(() => buildPagerank('   ')).toThrow(/non-empty/);
  });

  it('rejects non-string edge type', () => {
    expect(() => buildPagerank(123 as unknown as string)).toThrow(/edgeType/);
  });

  it('rejects damping <= 0', () => {
    expect(() => buildPagerank('knows', { damping: 0 })).toThrow(/damping/);
  });

  it('rejects damping >= 1', () => {
    expect(() => buildPagerank('knows', { damping: 1 })).toThrow(/damping/);
  });

  it('rejects damping above 1', () => {
    expect(() => buildPagerank('knows', { damping: 1.5 })).toThrow(/damping/);
  });

  it('rejects NaN damping', () => {
    expect(() => buildPagerank('knows', { damping: Number.NaN })).toThrow(
      /finite number/,
    );
  });

  it('rejects Infinity damping', () => {
    expect(() =>
      buildPagerank('knows', { damping: Number.POSITIVE_INFINITY }),
    ).toThrow(/finite number/);
  });

  it('rejects non-positive iterations', () => {
    expect(() => buildPagerank('knows', { iterations: 0 })).toThrow(
      /iterations/,
    );
  });

  it('rejects non-integer iterations', () => {
    expect(() => buildPagerank('knows', { iterations: 1.5 })).toThrow(
      /iterations/,
    );
  });

  it('rejects select containing a semicolon (SQL injection attempt)', () => {
    expect(() =>
      buildPagerank('knows', {
        select: '*; DROP TABLE users; --' as unknown as '*',
      }),
    ).toThrow(TypeError);
  });

  it('rejects raw projection string with comma-separated columns', () => {
    expect(() =>
      buildPagerank('knows', { select: 'node_id, score' as unknown as '*' }),
    ).toThrow(TypeError);
  });

  it('rejects empty select array', () => {
    expect(() => buildPagerank('knows', { select: [] })).toThrow(TypeError);
  });

  it('rejects array element with invalid identifier characters', () => {
    expect(() =>
      buildPagerank('knows', { select: ['node_id; DROP'] }),
    ).toThrow(TypeError);
  });

  it('rejects array element with whitespace', () => {
    expect(() =>
      buildPagerank('knows', { select: ['node id'] }),
    ).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// GDB-666: select length cap (applies to renderSelect, shared by all builders)
// ---------------------------------------------------------------------------

describe('select length cap (GDB-666)', () => {
  it('rejects an identifier longer than 64 characters', () => {
    const longIdent = 'a'.repeat(65);
    expect(() =>
      buildPagerank('e', { select: [longIdent] }),
    ).toThrow(RangeError);
  });

  it('accepts an identifier of exactly 64 characters', () => {
    const ident = 'a'.repeat(64);
    const q = buildPagerank('e', { select: [ident] });
    expect(q.text).toContain(`"${ident}"`);
  });

  it('rejects a select array with more than 1000 entries', () => {
    const columns = Array.from({ length: 1001 }, (_, i) => `col${i}`);
    expect(() =>
      buildPagerank('e', { select: columns }),
    ).toThrow(RangeError);
  });

  it('accepts a select array with exactly 1000 entries', () => {
    const columns = Array.from({ length: 1000 }, (_, i) => `c${i}`);
    const q = buildPagerank('e', { select: columns });
    expect(q.text).toContain('FROM pagerank');
  });

  it('rejects a 1MB raw string select (memory DoS vector)', () => {
    const hugeString = 'a'.repeat(1_000_000);
    expect(() =>
      buildPagerank('e', { select: hugeString as unknown as '*' }),
    ).toThrow(TypeError);
  });

  it('rejects raw string selects regardless of length', () => {
    // Even short raw strings are rejected — only '*' literal or string[] allowed
    expect(() =>
      buildPagerank('e', { select: 'node_id' as unknown as '*' }),
    ).toThrow(TypeError);
  });

  it('rejects non-string elements in select array', () => {
    expect(() =>
      buildPagerank('e', { select: [42 as unknown as string] }),
    ).toThrow(TypeError);
  });

  it('rejects empty string elements in select array', () => {
    expect(() =>
      buildPagerank('e', { select: [''] }),
    ).toThrow(TypeError);
  });

  it('applies the same length cap across all algorithm builders', () => {
    const longIdent = 'a'.repeat(65);
    const opts = { select: [longIdent] } as { select: string[] };

    expect(() => buildBetweennessCentrality('e', opts)).toThrow(RangeError);
    expect(() => buildConnectedComponents('e', opts)).toThrow(RangeError);
    expect(() => buildLouvain('e', opts)).toThrow(RangeError);
    expect(() => buildDegreeCentrality('e', opts)).toThrow(RangeError);
    expect(() => buildClosenessCentrality('e', opts)).toThrow(RangeError);
    expect(() => buildEigenvectorCentrality('e', opts)).toThrow(RangeError);
    expect(() => buildHarmonicCentrality('e', opts)).toThrow(RangeError);
    expect(() => buildClusteringCoefficient('e', opts)).toThrow(RangeError);
    expect(() => buildTriangleCount('e', opts)).toThrow(RangeError);
    expect(() => buildStronglyConnectedComponents('e', opts)).toThrow(RangeError);
  });

  it('applies the same array count cap across all algorithm builders', () => {
    const columns = Array.from({ length: 1001 }, (_, i) => `col${i}`);
    const opts = { select: columns };

    expect(() => buildBetweennessCentrality('e', opts)).toThrow(RangeError);
    expect(() => buildConnectedComponents('e', opts)).toThrow(RangeError);
    expect(() => buildLouvain('e', opts)).toThrow(RangeError);
    expect(() => buildDegreeCentrality('e', opts)).toThrow(RangeError);
    expect(() => buildClosenessCentrality('e', opts)).toThrow(RangeError);
    expect(() => buildEigenvectorCentrality('e', opts)).toThrow(RangeError);
    expect(() => buildHarmonicCentrality('e', opts)).toThrow(RangeError);
    expect(() => buildClusteringCoefficient('e', opts)).toThrow(RangeError);
    expect(() => buildTriangleCount('e', opts)).toThrow(RangeError);
    expect(() => buildStronglyConnectedComponents('e', opts)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// buildBetweennessCentrality
// ---------------------------------------------------------------------------

describe('buildBetweennessCentrality', () => {
  it('builds query with default select', () => {
    const q = buildBetweennessCentrality('knows');
    expect(q.text).toBe('SELECT * FROM betweenness_centrality($1)');
    expect(q.values).toEqual(['knows']);
  });

  it('respects custom select (array of identifiers)', () => {
    const q = buildBetweennessCentrality('knows', {
      select: ['node_id', 'score'],
    });
    expect(q.text).toBe(
      'SELECT "node_id", "score" FROM betweenness_centrality($1)',
    );
  });

  it('rejects empty edge type', () => {
    expect(() => buildBetweennessCentrality('')).toThrow(/edgeType/);
  });
});

// ---------------------------------------------------------------------------
// buildConnectedComponents
// ---------------------------------------------------------------------------

describe('buildConnectedComponents', () => {
  it('builds query with default select', () => {
    const q = buildConnectedComponents('knows');
    expect(q.text).toBe('SELECT * FROM connected_components($1)');
    expect(q.values).toEqual(['knows']);
  });

  it('rejects empty edge type', () => {
    expect(() => buildConnectedComponents('')).toThrow(/edgeType/);
  });
});

// ---------------------------------------------------------------------------
// buildLouvain
// ---------------------------------------------------------------------------

describe('buildLouvain', () => {
  it('builds with default resolution 1.0', () => {
    const q = buildLouvain('knows');
    expect(q.text).toBe('SELECT * FROM louvain($1, $2)');
    expect(q.values).toEqual(['knows', 1.0]);
  });

  it('respects custom resolution', () => {
    const q = buildLouvain('knows', { resolution: 2.5 });
    expect(q.values).toEqual(['knows', 2.5]);
  });

  it('rejects non-positive resolution', () => {
    expect(() => buildLouvain('knows', { resolution: 0 })).toThrow(
      /resolution/,
    );
  });

  it('rejects negative resolution', () => {
    expect(() => buildLouvain('knows', { resolution: -1 })).toThrow(
      /resolution/,
    );
  });

  it('rejects NaN resolution', () => {
    expect(() => buildLouvain('knows', { resolution: Number.NaN })).toThrow(
      /finite number/,
    );
  });

  it('rejects empty edge type', () => {
    expect(() => buildLouvain('')).toThrow(/edgeType/);
  });
});

// ---------------------------------------------------------------------------
// buildDegreeCentrality
// ---------------------------------------------------------------------------

describe('buildDegreeCentrality', () => {
  it('builds with default direction BOTH', () => {
    const q = buildDegreeCentrality('knows');
    expect(q.text).toBe('SELECT * FROM degree_centrality($1, $2)');
    expect(q.values).toEqual(['knows', 'BOTH']);
  });

  it('respects direction IN', () => {
    const q = buildDegreeCentrality('knows', { direction: 'IN' });
    expect(q.values).toEqual(['knows', 'IN']);
  });

  it('respects direction OUT', () => {
    const q = buildDegreeCentrality('knows', { direction: 'OUT' });
    expect(q.values).toEqual(['knows', 'OUT']);
  });

  it('uppercases lowercase direction input', () => {
    const q = buildDegreeCentrality('knows', { direction: 'in' });
    expect(q.values).toEqual(['knows', 'IN']);
  });

  it('rejects unknown direction', () => {
    expect(() =>
      buildDegreeCentrality('knows', {
        direction: 'sideways' as 'IN',
      }),
    ).toThrow(/direction/);
  });

  it('rejects empty edge type', () => {
    expect(() => buildDegreeCentrality('')).toThrow(/edgeType/);
  });
});

// ---------------------------------------------------------------------------
// buildClosenessCentrality
// ---------------------------------------------------------------------------

describe('buildClosenessCentrality', () => {
  it('builds with default variant STANDARD', () => {
    const q = buildClosenessCentrality('knows');
    expect(q.text).toBe('SELECT * FROM closeness_centrality($1, $2)');
    expect(q.values).toEqual(['knows', 'STANDARD']);
  });

  it('respects WASSERMAN_FAUST variant', () => {
    const q = buildClosenessCentrality('knows', {
      variant: 'WASSERMAN_FAUST',
    });
    expect(q.values).toEqual(['knows', 'WASSERMAN_FAUST']);
  });

  it('respects HARMONIC variant', () => {
    const q = buildClosenessCentrality('knows', { variant: 'HARMONIC' });
    expect(q.values).toEqual(['knows', 'HARMONIC']);
  });

  it('uppercases lowercase variant input', () => {
    const q = buildClosenessCentrality('knows', {
      variant: 'wasserman_faust',
    });
    expect(q.values).toEqual(['knows', 'WASSERMAN_FAUST']);
  });

  it('rejects unknown variant', () => {
    expect(() =>
      buildClosenessCentrality('knows', {
        variant: 'bogus' as 'STANDARD',
      }),
    ).toThrow(/variant/);
  });
});

// ---------------------------------------------------------------------------
// buildEigenvectorCentrality
// ---------------------------------------------------------------------------

describe('buildEigenvectorCentrality', () => {
  it('builds with default iterations and tolerance', () => {
    const q = buildEigenvectorCentrality('knows');
    expect(q.text).toBe(
      'SELECT * FROM eigenvector_centrality($1, $2, $3)',
    );
    expect(q.values).toEqual(['knows', 100, 1e-6]);
  });

  it('respects custom iterations and tolerance', () => {
    const q = buildEigenvectorCentrality('knows', {
      iterations: 50,
      tolerance: 1e-4,
    });
    expect(q.values).toEqual(['knows', 50, 1e-4]);
  });

  it('rejects non-positive iterations', () => {
    expect(() =>
      buildEigenvectorCentrality('knows', { iterations: 0 }),
    ).toThrow(/iterations/);
  });

  it('rejects non-positive tolerance', () => {
    expect(() =>
      buildEigenvectorCentrality('knows', { tolerance: 0 }),
    ).toThrow(/tolerance/);
  });

  it('rejects NaN tolerance', () => {
    expect(() =>
      buildEigenvectorCentrality('knows', { tolerance: Number.NaN }),
    ).toThrow(/finite number/);
  });

  it('rejects Infinity tolerance', () => {
    expect(() =>
      buildEigenvectorCentrality('knows', {
        tolerance: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(/finite number/);
  });
});

// ---------------------------------------------------------------------------
// Single-arg algorithms
// ---------------------------------------------------------------------------

describe('buildHarmonicCentrality', () => {
  it('builds query', () => {
    const q = buildHarmonicCentrality('knows');
    expect(q.text).toBe('SELECT * FROM harmonic_centrality($1)');
    expect(q.values).toEqual(['knows']);
  });

  it('rejects empty edge type', () => {
    expect(() => buildHarmonicCentrality('')).toThrow(/edgeType/);
  });
});

describe('buildClusteringCoefficient', () => {
  it('builds query', () => {
    const q = buildClusteringCoefficient('knows');
    expect(q.text).toBe('SELECT * FROM clustering_coefficient($1)');
    expect(q.values).toEqual(['knows']);
  });

  it('respects custom select (array of identifiers)', () => {
    const q = buildClusteringCoefficient('knows', {
      select: ['node_id', 'coefficient'],
    });
    expect(q.text).toBe(
      'SELECT "node_id", "coefficient" FROM clustering_coefficient($1)',
    );
  });

  it('rejects whitespace-only edge type', () => {
    expect(() => buildClusteringCoefficient('\t  \n')).toThrow(/non-empty/);
  });
});

describe('buildTriangleCount', () => {
  it('builds query', () => {
    const q = buildTriangleCount('knows');
    expect(q.text).toBe('SELECT * FROM triangle_count($1)');
    expect(q.values).toEqual(['knows']);
  });
});

describe('buildStronglyConnectedComponents', () => {
  it('builds query', () => {
    const q = buildStronglyConnectedComponents('follows');
    expect(q.text).toBe(
      'SELECT * FROM strongly_connected_components($1)',
    );
    expect(q.values).toEqual(['follows']);
  });

  it('rejects empty edge type', () => {
    expect(() => buildStronglyConnectedComponents('')).toThrow(/edgeType/);
  });
});

// ---------------------------------------------------------------------------
// Package-level exports
// ---------------------------------------------------------------------------

describe('algorithm builder package exports', () => {
  it('re-exports all 11 algorithm builders from the package index', () => {
    expect(typeof pkg.buildPagerank).toBe('function');
    expect(typeof pkg.buildBetweennessCentrality).toBe('function');
    expect(typeof pkg.buildConnectedComponents).toBe('function');
    expect(typeof pkg.buildLouvain).toBe('function');
    expect(typeof pkg.buildDegreeCentrality).toBe('function');
    expect(typeof pkg.buildClosenessCentrality).toBe('function');
    expect(typeof pkg.buildEigenvectorCentrality).toBe('function');
    expect(typeof pkg.buildHarmonicCentrality).toBe('function');
    expect(typeof pkg.buildClusteringCoefficient).toBe('function');
    expect(typeof pkg.buildTriangleCount).toBe('function');
    expect(typeof pkg.buildStronglyConnectedComponents).toBe('function');
  });
});
