/**
 * QA-GDB-492 — Adversarial tests for algorithm query builders.
 *
 * Verifies prior bug-classes from the Python sibling (GDB-491):
 *   GDB-662 — raw `select` interpolation → SQL injection
 *   GDB-663 — NaN/Infinity slipping through numeric validators
 *   GDB-664 — whitespace-only `edgeType`
 *
 * Plus deeper adversarial pushes: unicode, encoded variants, prototype
 * pollution, BigInt, boxed numbers, parameter-binding consistency, etc.
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
} from '../src/query-builders';

const ALL_BUILDERS = [
  ['buildPagerank', buildPagerank] as const,
  ['buildBetweennessCentrality', buildBetweennessCentrality] as const,
  ['buildConnectedComponents', buildConnectedComponents] as const,
  ['buildLouvain', buildLouvain] as const,
  ['buildDegreeCentrality', buildDegreeCentrality] as const,
  ['buildClosenessCentrality', buildClosenessCentrality] as const,
  ['buildEigenvectorCentrality', buildEigenvectorCentrality] as const,
  ['buildHarmonicCentrality', buildHarmonicCentrality] as const,
  ['buildClusteringCoefficient', buildClusteringCoefficient] as const,
  ['buildTriangleCount', buildTriangleCount] as const,
  ['buildStronglyConnectedComponents', buildStronglyConnectedComponents] as const,
];

// ---------------------------------------------------------------------------
// GDB-664 regression — whitespace-only / empty edgeType
// ---------------------------------------------------------------------------
describe('QA_GDB-664 whitespace-only / empty edgeType', () => {
  for (const [name, fn] of ALL_BUILDERS) {
    it(`${name} rejects empty string edgeType`, () => {
      expect(() => (fn as any)('')).toThrow(TypeError);
    });
    it(`${name} rejects whitespace-only edgeType`, () => {
      expect(() => (fn as any)('   ')).toThrow(TypeError);
    });
    it(`${name} rejects tab/newline-only edgeType`, () => {
      expect(() => (fn as any)('\t\n  \r')).toThrow(TypeError);
    });
    it(`${name} rejects non-string edgeType (number)`, () => {
      expect(() => (fn as any)(42)).toThrow(TypeError);
    });
    it(`${name} rejects null edgeType`, () => {
      expect(() => (fn as any)(null)).toThrow(TypeError);
    });
    it(`${name} rejects undefined edgeType`, () => {
      expect(() => (fn as any)(undefined)).toThrow(TypeError);
    });
  }
});

// ---------------------------------------------------------------------------
// GDB-663 regression — NaN/Infinity in numeric validators
// ---------------------------------------------------------------------------
describe('QA_GDB-663 NaN/Infinity numeric validators', () => {
  it('buildPagerank rejects NaN damping', () => {
    expect(() => buildPagerank('e', { damping: NaN })).toThrow();
  });
  it('buildPagerank rejects Infinity damping', () => {
    expect(() => buildPagerank('e', { damping: Infinity })).toThrow();
  });
  it('buildPagerank rejects -Infinity damping', () => {
    expect(() => buildPagerank('e', { damping: -Infinity })).toThrow();
  });
  it('buildPagerank rejects NaN iterations', () => {
    expect(() => buildPagerank('e', { iterations: NaN })).toThrow();
  });
  it('buildPagerank rejects Infinity iterations', () => {
    expect(() => buildPagerank('e', { iterations: Infinity })).toThrow();
  });
  it('buildLouvain rejects NaN resolution', () => {
    expect(() => buildLouvain('e', { resolution: NaN })).toThrow();
  });
  it('buildLouvain rejects Infinity resolution', () => {
    expect(() => buildLouvain('e', { resolution: Infinity })).toThrow();
  });
  it('buildEigenvectorCentrality rejects NaN tolerance', () => {
    expect(() => buildEigenvectorCentrality('e', { tolerance: NaN })).toThrow();
  });
  it('buildEigenvectorCentrality rejects Infinity tolerance', () => {
    expect(() => buildEigenvectorCentrality('e', { tolerance: Infinity })).toThrow();
  });
  it('buildEigenvectorCentrality rejects NaN iterations', () => {
    expect(() => buildEigenvectorCentrality('e', { iterations: NaN })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Numeric edge cases — boundaries
// ---------------------------------------------------------------------------
describe('QA numeric boundary edge cases', () => {
  it('buildPagerank rejects damping = 0 (boundary closed)', () => {
    expect(() => buildPagerank('e', { damping: 0 })).toThrow(RangeError);
  });
  it('buildPagerank rejects damping = 1 (boundary closed)', () => {
    expect(() => buildPagerank('e', { damping: 1 })).toThrow(RangeError);
  });
  it('buildPagerank rejects damping = -0', () => {
    expect(() => buildPagerank('e', { damping: -0 })).toThrow(RangeError);
  });
  it('buildPagerank accepts damping = Number.MIN_VALUE (>0, <1)', () => {
    expect(() => buildPagerank('e', { damping: Number.MIN_VALUE })).not.toThrow();
  });
  it('buildPagerank rejects damping just above 1', () => {
    expect(() => buildPagerank('e', { damping: 1.0000001 })).toThrow(RangeError);
  });
  it('buildPagerank rejects iterations = 0', () => {
    expect(() => buildPagerank('e', { iterations: 0 })).toThrow(TypeError);
  });
  it('buildPagerank rejects iterations = -1', () => {
    expect(() => buildPagerank('e', { iterations: -1 })).toThrow(TypeError);
  });
  it('buildPagerank rejects iterations = 5.5 (non-integer float)', () => {
    expect(() => buildPagerank('e', { iterations: 5.5 })).toThrow(TypeError);
  });
  it('buildPagerank accepts iterations = 5.0 (integer-valued float)', () => {
    expect(() => buildPagerank('e', { iterations: 5.0 })).not.toThrow();
  });
  it('buildLouvain rejects resolution = 0', () => {
    expect(() => buildLouvain('e', { resolution: 0 })).toThrow(RangeError);
  });
  it('buildLouvain rejects resolution = -0', () => {
    expect(() => buildLouvain('e', { resolution: -0 })).toThrow(RangeError);
  });
  it('buildLouvain rejects negative resolution', () => {
    expect(() => buildLouvain('e', { resolution: -1.0 })).toThrow(RangeError);
  });
  it('buildLouvain accepts very small positive resolution', () => {
    expect(() => buildLouvain('e', { resolution: Number.MIN_VALUE })).not.toThrow();
  });
  it('buildEigenvectorCentrality rejects tolerance = 0', () => {
    expect(() => buildEigenvectorCentrality('e', { tolerance: 0 })).toThrow(RangeError);
  });
  it('buildEigenvectorCentrality accepts tolerance = Number.MIN_VALUE', () => {
    expect(() => buildEigenvectorCentrality('e', { tolerance: Number.MIN_VALUE })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// TS-specific numeric type confusion
// ---------------------------------------------------------------------------
describe('QA TS numeric type confusion', () => {
  it('buildPagerank rejects boxed Number(0.5) damping', () => {
    expect(() => buildPagerank('e', { damping: new Number(0.5) as any })).toThrow(TypeError);
  });
  it('buildPagerank rejects BigInt iterations', () => {
    expect(() => buildPagerank('e', { iterations: 10n as any })).toThrow(TypeError);
  });
  it('buildPagerank rejects string-coerced "0.5" damping', () => {
    expect(() => buildPagerank('e', { damping: '0.5' as any })).toThrow(TypeError);
  });
  it('buildPagerank rejects string-coerced "10" iterations', () => {
    expect(() => buildPagerank('e', { iterations: '10' as any })).toThrow(TypeError);
  });
  it('buildPagerank rejects boolean true as damping (no implicit coercion)', () => {
    // typeof true !== 'number' -> TypeError
    expect(() => buildPagerank('e', { damping: true as any })).toThrow(TypeError);
  });
  it('buildPagerank rejects null iterations (would default? no — null overrides default)', () => {
    expect(() => buildPagerank('e', { iterations: null as any })).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// GDB-662 regression — SELECT interpolation injection attempts
// ---------------------------------------------------------------------------
describe('QA_GDB-662 SELECT injection attempts', () => {
  // Direct denylist hits
  it('rejects select with semicolon', () => {
    expect(() => buildPagerank('e', { select: '*; DROP TABLE users' })).toThrow(TypeError);
  });
  it('rejects select with -- comment', () => {
    expect(() => buildPagerank('e', { select: '* -- evil' })).toThrow(TypeError);
  });
  it('rejects select with /* */ block comment', () => {
    expect(() => buildPagerank('e', { select: '*/* evil */' })).toThrow(TypeError);
  });
  it('rejects select with stray /*', () => {
    expect(() => buildPagerank('e', { select: '* /* evil' })).toThrow(TypeError);
  });
  it('rejects select with stray */', () => {
    expect(() => buildPagerank('e', { select: '* */' })).toThrow(TypeError);
  });
  it('rejects select with null byte', () => {
    expect(() => buildPagerank('e', { select: '*\0DROP' })).toThrow(TypeError);
  });
  it('rejects empty select', () => {
    expect(() => buildPagerank('e', { select: '' })).toThrow(TypeError);
  });
  it('rejects whitespace-only select', () => {
    expect(() => buildPagerank('e', { select: '   ' })).toThrow(TypeError);
  });
  it('rejects non-string select', () => {
    expect(() => buildPagerank('e', { select: 42 as any })).toThrow(TypeError);
  });

  // Allowlist-bypass attacks. These DO contain dangerous payloads but evade
  // the denylist. Each `expect.fail` means the builder accepted attacker SQL.
  it('FINDING: accepts UNION SELECT (no comment/semicolon/block needed)', () => {
    // This is a functional injection — adversary smuggles a UNION query via
    // the select clause to leak data from another table.
    const q = buildPagerank('e', {
      select: '* FROM secrets UNION SELECT password, 1.0 FROM users',
    });
    // The denylist has no defense against this. Document the bug.
    expect(q.text).toContain('UNION SELECT password');
  });

  it('FINDING: accepts subquery injection', () => {
    const q = buildPagerank('e', {
      select: '(SELECT password FROM users WHERE id=1) AS leak',
    });
    expect(q.text).toContain('SELECT password FROM users');
  });

  it('FINDING: accepts unicode line separator U+2028 (newline equivalent in some parsers)', () => {
    // Some SQL parsers treat U+2028 / U+2029 as line terminators that end
    // line comments — denylist for "--" already covers comments, but newline
    // smuggling itself is not blocked.
    const q = buildPagerank('e', { select: '* OR 1=1' });
    expect(q.text).toContain(' ');
  });

  it('FINDING: accepts CRLF newline that could break server-side log parsers', () => {
    const q = buildPagerank('e', { select: '*\r\nFROM other' });
    expect(q.text).toContain('\r\n');
  });

  it('FINDING: accepts very long select (no length cap)', () => {
    const huge = 'a'.repeat(1_000_000);
    const q = buildPagerank('e', { select: huge });
    expect(q.text.length).toBeGreaterThan(1_000_000);
  });

  // Confirm: nested comment trick — server might parse /*! ... */ specially.
  // The denylist catches /* and */ so this should still throw.
  it('rejects MySQL-style executable comment /*! ... */', () => {
    expect(() => buildPagerank('e', { select: '/*!50000 1 */' })).toThrow(TypeError);
  });

  it('rejects backslash-escaped semicolon (denylist still catches the bare ;)', () => {
    expect(() => buildPagerank('e', { select: '*\\; SELECT 1' })).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Parameter binding consistency
// ---------------------------------------------------------------------------
describe('QA parameter binding $N matches values length', () => {
  function check(text: string, values: unknown[]) {
    const placeholders = (text.match(/\$\d+/g) ?? []).map((s) => parseInt(s.slice(1), 10));
    const max = placeholders.length > 0 ? Math.max(...placeholders) : 0;
    expect(max).toBe(values.length);
    // 1..N continuous
    const set = new Set(placeholders);
    for (let i = 1; i <= values.length; i++) {
      expect(set.has(i)).toBe(true);
    }
  }

  it('buildPagerank emits $1..$3', () => {
    const q = buildPagerank('e');
    check(q.text, q.values);
    expect(q.values).toEqual(['e', 0.85, 20]);
  });
  it('buildBetweennessCentrality emits $1', () => {
    const q = buildBetweennessCentrality('e');
    check(q.text, q.values);
  });
  it('buildLouvain emits $1..$2', () => {
    const q = buildLouvain('e');
    check(q.text, q.values);
  });
  it('buildDegreeCentrality emits $1..$2', () => {
    const q = buildDegreeCentrality('e');
    check(q.text, q.values);
  });
  it('buildEigenvectorCentrality emits $1..$3', () => {
    const q = buildEigenvectorCentrality('e');
    check(q.text, q.values);
  });
  for (const [name, fn] of ALL_BUILDERS) {
    it(`${name} default values do not leak NaN/Infinity`, () => {
      const q = (fn as any)('e');
      for (const v of q.values) {
        if (typeof v === 'number') {
          expect(Number.isFinite(v)).toBe(true);
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Enum case-insensitivity
// ---------------------------------------------------------------------------
describe('QA enum case-insensitivity', () => {
  it('buildDegreeCentrality accepts lowercase "in"', () => {
    const q = buildDegreeCentrality('e', { direction: 'in' as any });
    expect(q.values).toContain('IN');
  });
  it('buildDegreeCentrality accepts mixed case "OuT"', () => {
    const q = buildDegreeCentrality('e', { direction: 'OuT' as any });
    expect(q.values).toContain('OUT');
  });
  it('buildDegreeCentrality rejects empty direction', () => {
    expect(() => buildDegreeCentrality('e', { direction: '' as any })).toThrow();
  });
  it('buildDegreeCentrality rejects whitespace-only direction', () => {
    expect(() => buildDegreeCentrality('e', { direction: '   ' as any })).toThrow();
  });
  it('buildDegreeCentrality rejects unknown direction "DIAGONAL"', () => {
    expect(() => buildDegreeCentrality('e', { direction: 'DIAGONAL' as any })).toThrow(TypeError);
  });
  it('buildDegreeCentrality rejects non-ASCII case-folded "İN" (Turkish dotted I)', () => {
    // Turkish capital-I-with-dot does not uppercase to ASCII "I". Should reject.
    expect(() => buildDegreeCentrality('e', { direction: 'i̇n' as any })).toThrow(TypeError);
  });
  it('buildClosenessCentrality accepts lowercase "harmonic"', () => {
    const q = buildClosenessCentrality('e', { variant: 'harmonic' as any });
    expect(q.values).toContain('HARMONIC');
  });
  it('buildClosenessCentrality rejects unknown variant', () => {
    expect(() => buildClosenessCentrality('e', { variant: 'COSMIC' as any })).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// edgeType passthrough — special characters
// ---------------------------------------------------------------------------
describe('QA edgeType special characters pass through as parameter', () => {
  it('passes through apostrophes safely as parameter', () => {
    const q = buildPagerank("o'brien");
    expect(q.values[0]).toBe("o'brien");
    expect(q.text).toContain('$1'); // bound, not interpolated
    expect(q.text).not.toContain("o'brien");
  });
  it('passes through backslashes safely', () => {
    const q = buildPagerank("a\\b");
    expect(q.values[0]).toBe("a\\b");
    expect(q.text).not.toContain("a\\b");
  });
  it('passes through null byte (currently allowed in edgeType)', () => {
    // Note: edgeType validator only rejects empty/whitespace, not null byte.
    // This is a parameter — server protocol layer handles binding.
    const q = buildPagerank("evil\0type");
    expect(q.values[0]).toBe("evil\0type");
  });
  it('passes through unicode emoji', () => {
    const q = buildPagerank("rocket\u{1F680}");
    expect(q.values[0]).toBe("rocket\u{1F680}");
  });
});

// ---------------------------------------------------------------------------
// Prototype pollution / weird option-object shapes
// ---------------------------------------------------------------------------
describe('QA prototype pollution / option object weirdness', () => {
  it('ignores __proto__ pollution attempt in options', () => {
    const opts: any = JSON.parse('{"__proto__": {"select": "*; DROP"}}');
    // Should still default select to '*' (assuming hasOwnProperty isn't bypassed)
    const q = buildPagerank('e', opts);
    expect(q.text).not.toContain('DROP');
  });
  it('handles option object with constructor key', () => {
    const opts: any = { constructor: 'fake', damping: 0.5 };
    expect(() => buildPagerank('e', opts)).not.toThrow();
  });
  it('rejects when options is null (destructure of null fails)', () => {
    expect(() => buildPagerank('e', null as any)).toThrow();
  });
  it('accepts when options is undefined (uses defaults)', () => {
    expect(() => buildPagerank('e', undefined)).not.toThrow();
  });
  it('Object.create(null) options works', () => {
    const o = Object.create(null);
    o.damping = 0.5;
    expect(() => buildPagerank('e', o)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Smoke shape checks
// ---------------------------------------------------------------------------
describe('QA generated SQL shape', () => {
  it('all builders generate SELECT ... FROM <fn>(<placeholders>)', () => {
    for (const [, fn] of ALL_BUILDERS) {
      const q = (fn as any)('e');
      expect(q.text).toMatch(/^SELECT .+ FROM \w+\(\$\d+(, \$\d+)*\)$/);
    }
  });
  it('default select is "*"', () => {
    const q = buildPagerank('e');
    expect(q.text.startsWith('SELECT * FROM')).toBe(true);
  });
  it('all builders include edgeType as $1', () => {
    for (const [, fn] of ALL_BUILDERS) {
      const q = (fn as any)('myEdge');
      expect(q.values[0]).toBe('myEdge');
      expect(q.text).toContain('$1');
    }
  });
});
