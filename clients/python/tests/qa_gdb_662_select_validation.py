"""QA adversarial tests for GDB-662 — select parameter SQL injection fix.

Verifies the new ``_validate_select`` allowlist used by every algorithm
builder. The implementer chose: ``select`` accepts ``"*"``, ``None``, or a
``Sequence[str]`` of identifiers matching ``^[A-Za-z_][A-Za-z0-9_]*$``;
each accepted identifier is double-quoted via ``escape_identifier``.

These tests probe the boundaries of that allowlist looking for bypasses,
type confusion, TOCTOU races, DoS, and round-trip integrity.
"""

from __future__ import annotations

import pytest

from giodb.query_builders import (
    _validate_select,
    build_betweenness_centrality,
    build_closeness_centrality,
    build_clustering_coefficient,
    build_connected_components,
    build_degree_centrality,
    build_eigenvector_centrality,
    build_harmonic_centrality,
    build_louvain,
    build_pagerank,
    build_strongly_connected_components,
    build_triangle_count,
    escape_identifier,
)


# Every algorithm builder under test, with the minimal valid args.
ALL_BUILDERS = [
    (build_pagerank, ("knows",), {}),
    (build_betweenness_centrality, ("knows",), {}),
    (build_connected_components, ("knows",), {}),
    (build_louvain, ("knows",), {}),
    (build_degree_centrality, ("knows",), {}),
    (build_closeness_centrality, ("knows",), {}),
    (build_eigenvector_centrality, ("knows",), {}),
    (build_harmonic_centrality, ("knows",), {}),
    (build_clustering_coefficient, ("knows",), {}),
    (build_triangle_count, ("knows",), {}),
    (build_strongly_connected_components, ("knows",), {}),
]


# ---------------------------------------------------------------------------
# Original SQL injection vectors — must still be rejected
# ---------------------------------------------------------------------------


class TestOriginalInjectionVectorsStillRejected:
    """The vectors from GDB-662 must continue to fail."""

    @pytest.mark.parametrize("builder,args,kwargs", ALL_BUILDERS)
    def test_classic_injection_string_rejected(self, builder, args, kwargs):
        with pytest.raises(ValueError):
            builder(*args, select="*; DROP TABLE users; --", **kwargs)

    @pytest.mark.parametrize("builder,args,kwargs", ALL_BUILDERS)
    def test_comma_separated_string_rejected(self, builder, args, kwargs):
        # Old style with raw column list is gone.
        with pytest.raises(ValueError):
            builder(*args, select="node_id, score", **kwargs)

    @pytest.mark.parametrize("builder,args,kwargs", ALL_BUILDERS)
    def test_subquery_injection_rejected(self, builder, args, kwargs):
        with pytest.raises(ValueError):
            builder(*args, select="(SELECT password FROM users)", **kwargs)


# ---------------------------------------------------------------------------
# Allowlist bypass attempts via reserved words
# ---------------------------------------------------------------------------


class TestReservedWordIdentifiers:
    """Reserved words match the regex; verify they get safely quoted."""

    @pytest.mark.parametrize(
        "word",
        [
            "select", "from", "where", "union", "drop", "null",
            "true", "false", "case", "as", "join", "table",
            "DELETE", "INSERT", "UPDATE",
        ],
    )
    def test_reserved_word_is_quoted(self, word):
        sql = _validate_select([word])
        assert sql == f'"{word}"', (
            f"reserved word {word!r} must be double-quoted to be safe"
        )

    @pytest.mark.parametrize("word", ["select", "drop", "union"])
    def test_reserved_word_in_full_query(self, word):
        result = build_pagerank("knows", select=[word])
        # Must appear quoted in the final SQL, never bare.
        assert f'"{word}"' in result["text"]
        assert f"SELECT {word} FROM" not in result["text"]


# ---------------------------------------------------------------------------
# Unicode bypass attempts
# ---------------------------------------------------------------------------


class TestUnicodeBypassAttempts:
    """ASCII-only regex must reject any non-ASCII letter."""

    @pytest.mark.parametrize(
        "name",
        [
            "Аdmin",          # Cyrillic A (U+0410) + ASCII
            "ＡＢＣ",          # Fullwidth Latin (U+FF21..)
            "𝐀𝐝𝐦𝐢𝐧",    # Math bold (U+1D400+)
            "café",           # Latin-1 supplement
            "naïve",
            "user​",     # zero-width space
            "user ",     # non-breaking space
            "user ",     # line separator
            "ｓｅｌｅｃｔ",     # fullwidth "select"
        ],
    )
    def test_unicode_lookalikes_rejected(self, name):
        with pytest.raises(ValueError):
            _validate_select([name])


# ---------------------------------------------------------------------------
# Type confusion
# ---------------------------------------------------------------------------


class TestTypeConfusion:
    def test_bytes_rejected(self):
        with pytest.raises(ValueError):
            _validate_select(b"node_id")

    def test_bytearray_rejected(self):
        with pytest.raises(ValueError):
            _validate_select(bytearray(b"node_id"))

    def test_memoryview_rejected(self):
        # memoryview over bytes is iterable yielding ints; must not be
        # quietly accepted.
        with pytest.raises(ValueError):
            _validate_select(memoryview(b"node_id"))

    def test_generator_with_valid_columns_accepted(self):
        # Generators are valid Sequence-like input under list().
        sql = _validate_select(c for c in ["node_id", "score"])
        assert sql == '"node_id", "score"'

    def test_generator_with_invalid_column_rejected(self):
        with pytest.raises(ValueError):
            _validate_select(c for c in ["node_id", "bad; DROP"])

    def test_mapping_iterates_keys(self):
        # dict iterates keys; safe keys should be accepted.
        sql = _validate_select({"node_id": 1, "score": 2})
        assert "node_id" in sql and "score" in sql

    def test_set_with_valid_columns(self):
        # Sets are iterable; must not crash.
        sql = _validate_select({"node_id"})
        assert sql == '"node_id"'

    def test_tuple_accepted(self):
        sql = _validate_select(("node_id", "score"))
        assert sql == '"node_id", "score"'

    def test_int_in_list_rejected(self):
        with pytest.raises(ValueError):
            _validate_select(["node_id", 42])

    def test_none_in_list_rejected(self):
        with pytest.raises(ValueError):
            _validate_select(["node_id", None])

    def test_str_subclass_with_valid_value_accepted(self):
        class SafeStr(str):
            pass

        sql = _validate_select([SafeStr("node_id")])
        assert sql == '"node_id"'

    def test_str_subclass_overriding_methods_uses_actual_value(self):
        """A str subclass cannot lie about what it is.

        The validation reads the str value via the regex (which calls
        __str__ implicitly through the str interface) and then passes the
        SAME object to ``escape_identifier``, which does ``name.replace(...)``.
        Both operations see the actual underlying str data.
        """

        class LyingStr(str):
            def __str__(self):  # noqa: D401
                return "node_id"  # pretend safe

        # The actual content is malicious.
        bad = LyingStr('x"; DROP TABLE users; --')
        with pytest.raises(ValueError):
            _validate_select([bad])


# ---------------------------------------------------------------------------
# TOCTOU / mutation races
# ---------------------------------------------------------------------------


class TestMutationRace:
    """Validation snapshots into a list; subsequent mutation must not affect SQL."""

    def test_post_validation_mutation_does_not_affect_sql(self):
        cols = ["node_id", "score"]
        result = build_pagerank("knows", select=cols)
        cols.append("EVIL; DROP TABLE x")
        cols[0] = "hacked"
        # Generated SQL was already produced; must not contain mutations.
        assert "EVIL" not in result["text"]
        assert "hacked" not in result["text"]
        assert '"node_id"' in result["text"]
        assert '"score"' in result["text"]

    def test_iter_called_only_once(self):
        """A custom iterable that returns different values across iterations
        must not allow the validated values to differ from the SQL'd values.

        Implementation calls ``list(select)`` once and validates the snapshot;
        after that all references are to the snapshot, not the source.
        """

        call_count = {"n": 0}

        class TrickyIter:
            def __iter__(self):
                call_count["n"] += 1
                if call_count["n"] == 1:
                    return iter(["node_id", "score"])
                return iter(["EVIL; DROP", "MORE EVIL"])

        result = build_pagerank("knows", select=TrickyIter())
        assert "EVIL" not in result["text"]
        assert "DROP" not in result["text"]
        assert call_count["n"] == 1, (
            "select source iterated more than once — TOCTOU window!"
        )


# ---------------------------------------------------------------------------
# Identifier length
# ---------------------------------------------------------------------------


class TestIdentifierLength:
    def test_empty_string_rejected(self):
        with pytest.raises(ValueError):
            _validate_select([""])

    def test_single_char_accepted(self):
        assert _validate_select(["a"]) == '"a"'

    def test_64_char_accepted(self):
        name = "a" * 64
        sql = _validate_select([name])
        assert name in sql

    def test_very_long_accepted(self):
        # Regex is unbounded; the validator does not limit length. Ensure
        # it neither hangs nor crashes for a reasonable "very long" name.
        name = "a" * 10_000
        sql = _validate_select([name])
        assert name in sql


# ---------------------------------------------------------------------------
# Special characters
# ---------------------------------------------------------------------------


class TestSpecialCharacters:
    @pytest.mark.parametrize(
        "name",
        [
            "col\x00",          # null byte
            "col\r",
            "col\t",
            "col;DROP",
            'col"',
            "col'",
            "col--",
            "col/*",
            " col",             # leading space
            "col ",             # trailing space
            "col col",
            "1col",             # leading digit
            "col-name",
            "col.name",
            "col$name",
            "*",                # star inside list (only bare '*' is allowed)
            "",
        ],
    )
    def test_invalid_identifier_rejected(self, name):
        with pytest.raises(ValueError):
            _validate_select([name])


# ---------------------------------------------------------------------------
# DoS via very large list
# ---------------------------------------------------------------------------


class TestLargeInputs:
    def test_large_list_does_not_crash(self):
        cols = [f"col_{i}" for i in range(10_000)]
        sql = _validate_select(cols)
        # All columns should appear in SQL.
        assert sql.count(",") == 9_999

    def test_empty_list_rejected(self):
        with pytest.raises(ValueError):
            _validate_select([])

    def test_empty_tuple_rejected(self):
        with pytest.raises(ValueError):
            _validate_select(())


# ---------------------------------------------------------------------------
# Round-trip: every accepted identifier appears verbatim (quoted) in SQL
# ---------------------------------------------------------------------------


class TestRoundTrip:
    @pytest.mark.parametrize(
        "cols",
        [
            ["node_id"],
            ["node_id", "score"],
            ["a", "b", "c", "d", "e"],
            ["snake_case_col"],
            ["camelCase"],
            ["UPPERCASE"],
            ["_leading_underscore"],
            ["mixed_123"],
            ["x" * 100],
        ],
    )
    def test_columns_appear_verbatim_quoted(self, cols):
        sql = _validate_select(cols)
        for c in cols:
            assert f'"{c}"' in sql, f"column {c!r} missing from SQL: {sql}"
        # No reordering: order of quoted tokens must match input order.
        positions = [sql.find(f'"{c}"') for c in cols]
        assert positions == sorted(positions), "select columns reordered"

    @pytest.mark.parametrize("builder,args,kwargs", ALL_BUILDERS)
    def test_default_select_is_star(self, builder, args, kwargs):
        result = builder(*args, **kwargs)
        assert result["text"].startswith("SELECT * FROM "), (
            f"builder {builder.__name__} default select should be '*'"
        )

    @pytest.mark.parametrize("builder,args,kwargs", ALL_BUILDERS)
    def test_none_treated_as_star(self, builder, args, kwargs):
        result = builder(*args, select=None, **kwargs)
        assert result["text"].startswith("SELECT * FROM ")

    @pytest.mark.parametrize("builder,args,kwargs", ALL_BUILDERS)
    def test_list_select_routes_through_validator(self, builder, args, kwargs):
        result = builder(*args, select=["node_id", "score"], **kwargs)
        assert 'SELECT "node_id", "score" FROM ' in result["text"]

    @pytest.mark.parametrize("builder,args,kwargs", ALL_BUILDERS)
    def test_injection_via_list_element_rejected(self, builder, args, kwargs):
        with pytest.raises(ValueError):
            builder(*args, select=["node_id", "x; DROP TABLE y"], **kwargs)


# ---------------------------------------------------------------------------
# escape_identifier behaviour — the safety net for any allowlisted name
# ---------------------------------------------------------------------------


class TestEscapeIdentifier:
    def test_doubles_embedded_quote(self):
        assert escape_identifier('a"b') == '"a""b"'

    def test_wraps_in_double_quotes(self):
        assert escape_identifier("foo") == '"foo"'

    def test_no_select_path_can_smuggle_a_quote(self):
        """Any name accepted by _validate_select is regex-restricted to
        [A-Za-z0-9_], so it can never contain a double quote."""
        # If this ever changes, escape_identifier still neutralises quotes.
        for c in ['"', "'", ";", "\\", "\x00"]:
            with pytest.raises(ValueError):
                _validate_select([f"col{c}"])


# ---------------------------------------------------------------------------
# Parameter-binding isolation: select identifiers are NOT confused with
# parameter values bound at $1/$2/...
# ---------------------------------------------------------------------------


class TestParameterIsolation:
    def test_select_identifier_collision_with_param_alias(self):
        """A column named 'x' must not be conflated with parameter $1, $2, etc."""
        result = build_pagerank("knows", select=["x"])
        # SQL contains both the quoted column and parameter placeholders.
        assert 'SELECT "x" FROM pagerank($1, $2, $3)' == result["text"]
        # The "x" never appears as a value.
        assert "x" not in result["values"]

    def test_select_does_not_consume_parameter_slot(self):
        result = build_pagerank("knows", select=["a", "b", "c"])
        # values length unaffected by select length.
        assert result["values"] == ["knows", 0.85, 20]


# ---------------------------------------------------------------------------
# GDB-491 regression context — confirm out-of-scope items are still NOT fixed
# ---------------------------------------------------------------------------


class TestNewValidatorBypass:
    """Bug found by adversarial testing of the new _validate_select."""

    def test_trailing_newline_rejected(self):
        """GDB-669 fix: ``re.match`` with ``^...$`` allowed a trailing
        ``\\n`` to slip past the allowlist. The validator now uses
        ``re.fullmatch`` so any identifier with a trailing newline
        (``\\n``, ``\\r``, ``\\r\\n``) is rejected.
        """
        for bad in ("col\n", "col\r", "col\r\n", "col\n\n"):
            with pytest.raises(ValueError):
                _validate_select([bad])


class TestOutOfScopeRegressions:
    """Status check on adjacent bugs filed earlier."""

    def test_gdb_663_nan_now_rejected(self):
        """GDB-663 appears to have been fixed in this PR as a side effect:
        ``0.0 < float(nan) < 1.0`` is False so NaN is rejected. Pin it
        so any future regression is caught."""
        with pytest.raises(ValueError):
            build_pagerank("knows", damping=float("nan"))
        with pytest.raises(ValueError):
            build_pagerank("knows", damping=float("inf"))
        with pytest.raises(ValueError):
            build_pagerank("knows", damping=float("-inf"))

    def test_gdb_664_whitespace_edge_type_rejected(self):
        """GDB-664 fix: whitespace-only ``edge_type`` strings are now
        rejected by ``_validate_non_empty_str`` (it strips before the
        emptiness check). Pin the fix so any future regression is caught.
        """
        for bad in ("   ", "\t", "\n", "\r\n", "\t \r\n "):
            with pytest.raises(ValueError, match="edge_type"):
                build_pagerank(bad)
