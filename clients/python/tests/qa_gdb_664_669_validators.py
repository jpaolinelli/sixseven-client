"""QA adversarial tests for GDB-664 (whitespace edge_type rejection) and
GDB-669 (_IDENTIFIER_RE trailing-newline rejection via fullmatch).

GDB-664: ``_validate_non_empty_str`` was changed from ``if not value`` to
``if not value or not value.strip()``. Verify whitespace-only strings are
rejected — including Unicode whitespace handled by ``str.strip()``.

GDB-669: ``_IDENTIFIER_RE.match(col)`` was changed to
``_IDENTIFIER_RE.fullmatch(col)``. Verify identifiers with trailing
newlines/whitespace and other suffix junk are rejected, while still
accepting all legitimate identifiers.
"""

from __future__ import annotations

import re

import pytest

from giodb.query_builders import (
    _IDENTIFIER_RE,
    _validate_non_empty_str,
    _validate_select,
    build_betweenness_centrality,
    build_clustering_coefficient,
    build_closeness_centrality,
    build_connected_components,
    build_degree_centrality,
    build_eigenvector_centrality,
    build_harmonic_centrality,
    build_louvain,
    build_pagerank,
    build_strongly_connected_components,
    build_triangle_count,
)


# ---------------------------------------------------------------------------
# GDB-664: _validate_non_empty_str whitespace rejection
# ---------------------------------------------------------------------------


class Test_GDB_664_AsciiWhitespace:
    """Pure ASCII whitespace strings must be rejected."""

    @pytest.mark.parametrize(
        "value",
        [
            " ",
            "  ",
            "\t",
            "\n",
            "\r",
            "\r\n",
            " \t\n\r ",
            "\x0b",  # vertical tab
            "\x0c",  # form feed
        ],
    )
    def test_rejects_pure_ascii_whitespace(self, value: str) -> None:
        with pytest.raises(ValueError, match="non-empty string"):
            _validate_non_empty_str(value, "edge_type")

    def test_rejects_empty_string(self) -> None:
        with pytest.raises(ValueError, match="non-empty string"):
            _validate_non_empty_str("", "edge_type")


class Test_GDB_664_UnicodeWhitespace:
    """Unicode whitespace handling — documents what str.strip() recognizes."""

    @pytest.mark.parametrize(
        "value,desc",
        [
            (" ", "NBSP"),
            ("　", "ideographic space"),
            (" ", "figure space"),
            (" ", "line separator"),
            (" ", "paragraph separator"),
            (" ", "en quad"),
            (" ", "em quad"),
            (" ", "en space"),
            (" ", "em space"),
            (" ", "three-per-em space"),
            (" ", "four-per-em space"),
            (" ", "six-per-em space"),
            (" ", "punctuation space"),
            (" ", "thin space"),
            (" ", "hair space"),
            (" ", "narrow no-break space"),
            (" ", "medium mathematical space"),
            (" ", "ogham space mark"),
            ("", "next line"),
        ],
    )
    def test_rejects_unicode_whitespace(self, value: str, desc: str) -> None:
        # Sanity: Python considers these whitespace
        assert value.isspace(), f"precondition: {desc} should be whitespace"
        with pytest.raises(ValueError, match="non-empty string"):
            _validate_non_empty_str(value, "edge_type")

    @pytest.mark.parametrize(
        "value,desc",
        [
            ("​", "zero-width space"),
            ("‌", "zero-width non-joiner"),
            ("‍", "zero-width joiner"),
            ("﻿", "BOM / zero-width no-break"),
        ],
    )
    def test_documents_zero_width_codepoints_not_stripped(
        self, value: str, desc: str
    ) -> None:
        """Zero-width formatting chars are NOT whitespace per str.isspace().

        Python's ``str.strip()`` will not remove them. So a string consisting
        purely of zero-width chars passes ``_validate_non_empty_str``. This
        is documented behavior — the validator's job is to reject *blank*
        strings, not all invisible content. Server-side validation should
        catch invalid edge type names. This test pins the documented
        behavior so future changes are intentional.
        """
        assert not value.isspace()
        # Should NOT raise
        _validate_non_empty_str(value, "edge_type")


class Test_GDB_664_BoundaryAcceptance:
    """Strings with whitespace AND visible chars should be accepted."""

    @pytest.mark.parametrize("value", [" x", "x ", " x ", "x y", "\tedge\n"])
    def test_accepts_string_with_visible_chars(self, value: str) -> None:
        # Should not raise
        _validate_non_empty_str(value, "edge_type")

    def test_accepts_single_visible_char(self) -> None:
        _validate_non_empty_str("x", "edge_type")


class Test_GDB_664_NonStringTypes:
    """Non-string types should be rejected with a type-specific error."""

    @pytest.mark.parametrize(
        "value",
        [None, 123, 1.5, True, False, b"bytes", ["a"], ("a",), {"a": 1}, object()],
    )
    def test_rejects_non_string(self, value: object) -> None:
        with pytest.raises(ValueError, match="must be a string"):
            _validate_non_empty_str(value, "edge_type")


class Test_GDB_664_ParameterPassthrough:
    """Whitespace-bearing edge_types that pass validation are bound as-is."""

    def test_edge_type_with_surrounding_whitespace_passed_verbatim(self) -> None:
        """No silent trimming — the validator accepts " x ", and the bound
        parameter is the unmodified string. The server is responsible for
        rejecting weird edge type names at SQL execution time.
        """
        result = build_pagerank(" knows ")
        assert result["values"][0] == " knows "

    def test_edge_type_with_internal_whitespace_passed_verbatim(self) -> None:
        result = build_louvain("knows\tfriend")
        assert result["values"][0] == "knows\tfriend"

    def test_error_message_includes_param_name_pagerank(self) -> None:
        with pytest.raises(ValueError, match="edge_type"):
            build_pagerank(" ")

    def test_error_message_includes_param_name_louvain(self) -> None:
        with pytest.raises(ValueError, match="edge_type"):
            build_louvain("\n")

    def test_error_message_includes_param_name_degree_direction(self) -> None:
        # direction is also validated with _validate_non_empty_str
        with pytest.raises(ValueError, match="direction"):
            build_degree_centrality("knows", "   ")

    def test_error_message_includes_param_name_closeness_variant(self) -> None:
        with pytest.raises(ValueError, match="variant"):
            build_closeness_centrality("knows", "\t\n")


class Test_GDB_664_AllAlgorithmBuildersReject:
    """Every algorithm builder using _validate_non_empty_str on edge_type
    must reject whitespace-only strings."""

    BUILDERS = [
        build_pagerank,
        build_betweenness_centrality,
        build_connected_components,
        build_louvain,
        build_degree_centrality,
        build_closeness_centrality,
        build_eigenvector_centrality,
        build_harmonic_centrality,
        build_clustering_coefficient,
        build_triangle_count,
        build_strongly_connected_components,
    ]

    @pytest.mark.parametrize("builder", BUILDERS)
    @pytest.mark.parametrize("value", ["", " ", "\t", "\n", "\r\n", " "])
    def test_builder_rejects_whitespace_edge_type(self, builder, value: str) -> None:
        with pytest.raises(ValueError, match="edge_type"):
            builder(value)


# ---------------------------------------------------------------------------
# GDB-669: _IDENTIFIER_RE.fullmatch rejects trailing junk
# ---------------------------------------------------------------------------


class Test_GDB_669_TrailingNewlineRejection:
    """The regression: ``re.match`` accepted ``"col\\n"`` because it
    anchors only at the start. ``re.fullmatch`` rejects it.
    """

    @pytest.mark.parametrize(
        "value",
        [
            "col\n",
            "col\r",
            "col\r\n",
            "col\t",
            "col ",
            "col\x00",  # NUL byte
            "col;DROP TABLE users",
            "col--comment",
            "col/*comment*/",
            "col)",
            "col(",
            "col,",
            "col*",
        ],
    )
    def test_rejects_trailing_junk(self, value: str) -> None:
        with pytest.raises(ValueError, match="not a valid identifier"):
            _validate_select([value])

    def test_rejects_long_identifier_with_trailing_newline(self) -> None:
        value = "a" * 1000 + "\n"
        with pytest.raises(ValueError, match="not a valid identifier"):
            _validate_select([value])

    def test_rejects_embedded_newline(self) -> None:
        with pytest.raises(ValueError, match="not a valid identifier"):
            _validate_select(["co\nl"])

    def test_rejects_embedded_space(self) -> None:
        with pytest.raises(ValueError, match="not a valid identifier"):
            _validate_select(["co l"])

    def test_rejects_embedded_nul(self) -> None:
        with pytest.raises(ValueError, match="not a valid identifier"):
            _validate_select(["co\x00l"])

    def test_rejects_leading_whitespace(self) -> None:
        with pytest.raises(ValueError, match="not a valid identifier"):
            _validate_select([" col"])

    def test_rejects_leading_newline(self) -> None:
        with pytest.raises(ValueError, match="not a valid identifier"):
            _validate_select(["\ncol"])


class Test_GDB_669_FullmatchEquivalence:
    """Verify ``fullmatch`` on the current regex is equivalent to
    ``\\A...\\Z`` anchors. Regex has no MULTILINE flag — confirm it.
    """

    def test_no_multiline_flag(self) -> None:
        assert not (_IDENTIFIER_RE.flags & re.MULTILINE)
        assert not (_IDENTIFIER_RE.flags & re.DOTALL)

    @pytest.mark.parametrize(
        "value",
        ["foo", "_foo", "_", "a", "Z9", "snake_case", "a1b2c3", "X", "Y_1"],
    )
    def test_fullmatch_accepts_valid_identifiers(self, value: str) -> None:
        assert _IDENTIFIER_RE.fullmatch(value) is not None

    @pytest.mark.parametrize(
        "value",
        ["1foo", "9abc", "0", "-foo", "foo-bar", ".foo", "$foo", "foo.bar"],
    )
    def test_fullmatch_rejects_invalid_starts_or_chars(self, value: str) -> None:
        assert _IDENTIFIER_RE.fullmatch(value) is None

    def test_fullmatch_differs_from_match_on_trailing_newline(self) -> None:
        """The exact regression: re.match accepted the buggy input."""
        assert _IDENTIFIER_RE.match("col\n") is not None  # OLD bug
        assert _IDENTIFIER_RE.fullmatch("col\n") is None  # NEW fix


class Test_GDB_669_UnicodeIdentifiers:
    """Identifiers must be ASCII-only — Unicode lookalikes rejected."""

    @pytest.mark.parametrize(
        "value,desc",
        [
            ("соl", "Cyrillic 'col' (с and о are Cyrillic)"),
            ("ｃｏｌ", "fullwidth letters"),
            ("𝐜𝐨𝐥", "math bold"),
            ("cól", "combining acute accent"),
            ("café", "accented latin"),
            ("naïve", "diaeresis"),
            ("col​", "trailing zero-width space"),
            ("\U0001F600", "emoji"),
            ("col\U0001F4A9", "trailing emoji"),
            ("\U0001D400", "math italic A (surrogate-range BMP+)"),
        ],
    )
    def test_rejects_non_ascii_identifiers(self, value: str, desc: str) -> None:
        with pytest.raises(ValueError, match="not a valid identifier"):
            _validate_select([value])


class Test_GDB_669_QuotedKeywordsStillAccepted:
    """SQL keywords are valid identifiers (allowlist quotes them safely).
    Sanity-check from GDB-662 review still holds."""

    @pytest.mark.parametrize(
        "value", ["select", "from", "where", "drop", "table", "delete", "insert"]
    )
    def test_keyword_as_column_name_accepted(self, value: str) -> None:
        result = _validate_select([value])
        assert result == f'"{value}"'


class Test_GDB_669_MixedValidInvalidShortCircuits:
    """When a list has mixed valid/invalid entries, the invalid one fails
    with a clear error mentioning that specific identifier."""

    def test_first_valid_second_invalid(self) -> None:
        with pytest.raises(ValueError) as exc_info:
            _validate_select(["valid", "col\n"])
        # The error message should contain the repr of the bad value,
        # which includes the escaped newline.
        msg = str(exc_info.value)
        assert "col\\n" in msg, f"Expected escaped newline in: {msg!r}"
        assert "not a valid identifier" in msg

    def test_first_invalid_short_circuits(self) -> None:
        # Should fail on first bad value, not silently include valid ones
        with pytest.raises(ValueError, match="not a valid identifier"):
            _validate_select(["bad name", "good_name"])


# ---------------------------------------------------------------------------
# Integration: realistic combined call
# ---------------------------------------------------------------------------


class Test_Integration_CombinedRejections:
    """Both bugs — exercised through a realistic builder call."""

    def test_pagerank_rejects_whitespace_edge_type_first(self) -> None:
        # edge_type validated before select
        with pytest.raises(ValueError, match="edge_type"):
            build_pagerank(" ", select=["col\n"])

    def test_pagerank_rejects_select_newline_when_edge_type_valid(self) -> None:
        with pytest.raises(ValueError, match="not a valid identifier"):
            build_pagerank("knows", select=["col\n"])

    def test_pagerank_happy_path_unaffected(self) -> None:
        result = build_pagerank("knows", select=["node_id", "score"])
        assert result["text"] == 'SELECT "node_id", "score" FROM pagerank($1, $2, $3)'
        assert result["values"] == ["knows", 0.85, 20]

    def test_pagerank_star_select_unaffected(self) -> None:
        result = build_pagerank("knows")
        assert result["text"] == "SELECT * FROM pagerank($1, $2, $3)"

    def test_louvain_with_select_list_unaffected(self) -> None:
        result = build_louvain("knows", select=["community_id"])
        assert "community_id" in result["text"]
        assert result["values"][0] == "knows"
