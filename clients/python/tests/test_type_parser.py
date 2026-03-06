"""Tests for type OID parsing and embedding serialization."""

import json
import math
import uuid

import numpy as np
import pytest

from giodb.type_parser import (
    TypeOID,
    parse_embedding,
    parse_value,
    serialize_embedding,
)


class TestTypeOIDConstants:
    def test_all_defined(self):
        assert TypeOID.BOOL == 16
        assert TypeOID.INT2 == 21
        assert TypeOID.INT4 == 23
        assert TypeOID.INT8 == 20
        assert TypeOID.FLOAT4 == 700
        assert TypeOID.FLOAT8 == 701
        assert TypeOID.NUMERIC == 1700
        assert TypeOID.TEXT == 25
        assert TypeOID.BYTEA == 17
        assert TypeOID.DATE == 1082
        assert TypeOID.TIME == 1083
        assert TypeOID.TIMESTAMP == 1114
        assert TypeOID.INTERVAL == 1186
        assert TypeOID.POINT == 600
        assert TypeOID.JSON == 114
        assert TypeOID.UUID == 2950
        assert TypeOID.EMBEDDING == 100000


class TestParseBool:
    def test_true_values(self):
        assert parse_value(TypeOID.BOOL, "t") is True
        assert parse_value(TypeOID.BOOL, "true") is True
        assert parse_value(TypeOID.BOOL, "1") is True
        assert parse_value(TypeOID.BOOL, "TRUE") is True

    def test_false_values(self):
        assert parse_value(TypeOID.BOOL, "f") is False
        assert parse_value(TypeOID.BOOL, "false") is False
        assert parse_value(TypeOID.BOOL, "0") is False
        assert parse_value(TypeOID.BOOL, "FALSE") is False


class TestParseIntegers:
    def test_int2(self):
        assert parse_value(TypeOID.INT2, "42") == 42
        assert parse_value(TypeOID.INT2, "-1") == -1
        assert parse_value(TypeOID.INT2, "0") == 0

    def test_int4(self):
        assert parse_value(TypeOID.INT4, "2147483647") == 2147483647
        assert parse_value(TypeOID.INT4, "-2147483648") == -2147483648

    def test_int8(self):
        assert parse_value(TypeOID.INT8, "9223372036854775807") == 9223372036854775807
        assert parse_value(TypeOID.INT8, "-9223372036854775808") == -9223372036854775808


class TestParseFloats:
    def test_float4(self):
        assert parse_value(TypeOID.FLOAT4, "3.14") == pytest.approx(3.14)
        assert parse_value(TypeOID.FLOAT4, "-0.5") == pytest.approx(-0.5)

    def test_float8(self):
        assert parse_value(TypeOID.FLOAT8, "1.7976931348623157e+308") == pytest.approx(
            1.7976931348623157e308
        )

    def test_special_floats(self):
        assert math.isinf(parse_value(TypeOID.FLOAT4, "Infinity"))
        assert math.isinf(parse_value(TypeOID.FLOAT4, "-Infinity"))
        assert math.isnan(parse_value(TypeOID.FLOAT4, "NaN"))


class TestParseJSON:
    def test_object(self):
        result = parse_value(TypeOID.JSON, '{"key": "value"}')
        assert result == {"key": "value"}

    def test_array(self):
        result = parse_value(TypeOID.JSON, "[1, 2, 3]")
        assert result == [1, 2, 3]

    def test_nested(self):
        result = parse_value(TypeOID.JSON, '{"a": [1, {"b": 2}]}')
        assert result == {"a": [1, {"b": 2}]}

    def test_invalid_json(self):
        with pytest.raises(json.JSONDecodeError):
            parse_value(TypeOID.JSON, "not json")


class TestParseUUID:
    def test_valid_uuid(self):
        uid = "550e8400-e29b-41d4-a716-446655440000"
        result = parse_value(TypeOID.UUID, uid)
        assert isinstance(result, uuid.UUID)
        assert str(result) == uid

    def test_invalid_uuid(self):
        with pytest.raises(ValueError):
            parse_value(TypeOID.UUID, "not-a-uuid")


class TestParseEmbedding:
    def test_basic(self):
        result = parse_embedding("[0.1,0.2,0.3]")
        assert isinstance(result, np.ndarray)
        assert result.dtype == np.float32
        np.testing.assert_array_almost_equal(result, [0.1, 0.2, 0.3], decimal=5)

    def test_empty(self):
        result = parse_embedding("[]")
        assert isinstance(result, np.ndarray)
        assert len(result) == 0

    def test_single_value(self):
        result = parse_embedding("[1.5]")
        np.testing.assert_array_almost_equal(result, [1.5], decimal=5)

    def test_scientific_notation(self):
        result = parse_embedding("[1e-5,2.5e3]")
        np.testing.assert_array_almost_equal(result, [1e-5, 2.5e3], decimal=5)

    def test_whitespace(self):
        result = parse_embedding("[ 0.1 , 0.2 , 0.3 ]")
        np.testing.assert_array_almost_equal(result, [0.1, 0.2, 0.3], decimal=5)

    def test_via_parse_value(self):
        result = parse_value(TypeOID.EMBEDDING, "[1.0,2.0]")
        assert isinstance(result, np.ndarray)


class TestSerializeEmbedding:
    def test_numpy_array(self):
        arr = np.array([0.1, 0.2, 0.3], dtype=np.float32)
        result = serialize_embedding(arr)
        assert result.startswith("[")
        assert result.endswith("]")
        # Should contain 3 values
        parts = result[1:-1].split(",")
        assert len(parts) == 3

    def test_python_list(self):
        result = serialize_embedding([1.0, 2.0, 3.0])
        assert result == "[1.0,2.0,3.0]"

    def test_empty(self):
        result = serialize_embedding(np.array([], dtype=np.float32))
        assert result == "[]"

    def test_roundtrip(self):
        original = np.array([0.1, 0.5, 0.9], dtype=np.float32)
        serialized = serialize_embedding(original)
        parsed = parse_embedding(serialized)
        np.testing.assert_array_almost_equal(original, parsed, decimal=5)


class TestParseValueFallback:
    def test_unregistered_type_returns_string(self):
        # Use a truly unregistered OID (POINT = 600 has no parser)
        result = parse_value(TypeOID.POINT, "(1.0,2.0)")
        assert result == "(1.0,2.0)"

    def test_text_returns_string(self):
        result = parse_value(TypeOID.TEXT, "hello")
        assert result == "hello"

    def test_unknown_oid_returns_string(self):
        result = parse_value(99999, "raw value")
        assert result == "raw value"
