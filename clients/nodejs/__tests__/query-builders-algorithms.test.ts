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

  it('respects a custom select projection', () => {
    const q = buildPagerank('knows', { select: 'node_id, score' });
    expect(q.text).toBe('SELECT node_id, score FROM pagerank($1, $2, $3)');
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
      buildPagerank('knows', { select: '*; DROP TABLE users; --' }),
    ).toThrow(/disallowed SQL/);
  });

  it('rejects select containing a SQL line comment', () => {
    expect(() => buildPagerank('knows', { select: '* -- haha' })).toThrow(
      /disallowed SQL/,
    );
  });

  it('rejects select containing a block comment', () => {
    expect(() => buildPagerank('knows', { select: '/* x */ *' })).toThrow(
      /disallowed SQL/,
    );
  });

  it('rejects empty select', () => {
    expect(() => buildPagerank('knows', { select: '' })).toThrow(/select/);
  });

  it('rejects select containing a null byte', () => {
    expect(() => buildPagerank('knows', { select: '*\0' })).toThrow(
      /disallowed SQL/,
    );
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

  it('respects custom select', () => {
    const q = buildBetweennessCentrality('knows', {
      select: 'node_id, score',
    });
    expect(q.text).toBe(
      'SELECT node_id, score FROM betweenness_centrality($1)',
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

  it('respects custom select', () => {
    const q = buildClusteringCoefficient('knows', {
      select: 'node_id, coefficient',
    });
    expect(q.text).toBe(
      'SELECT node_id, coefficient FROM clustering_coefficient($1)',
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
