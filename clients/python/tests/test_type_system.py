"""Tests for the complete type system (all 22 server types)."""

from __future__ import annotations

import datetime
import decimal

import numpy as np
import pytest

from giodb.type_parser import TypeOID, parse_value


class TestDateTimeTypes:
    def test_date(self):
        result = parse_value(TypeOID.DATE, "2024-01-15")
        assert isinstance(result, datetime.date)
        assert result == datetime.date(2024, 1, 15)

    def test_time(self):
        result = parse_value(TypeOID.TIME, "14:30:00")
        assert isinstance(result, datetime.time)
        assert result == datetime.time(14, 30, 0)

    def test_time_with_microseconds(self):
        result = parse_value(TypeOID.TIME, "14:30:00.123456")
        assert isinstance(result, datetime.time)
        assert result.microsecond == 123456

    def test_timestamp(self):
        result = parse_value(TypeOID.TIMESTAMP, "2024-01-15 14:30:00")
        assert isinstance(result, datetime.datetime)
        assert result.year == 2024
        assert result.hour == 14

    def test_timestamp_with_t(self):
        result = parse_value(TypeOID.TIMESTAMP, "2024-01-15T14:30:00")
        assert isinstance(result, datetime.datetime)

    def test_interval_hms(self):
        result = parse_value(TypeOID.INTERVAL, "02:30:00")
        assert isinstance(result, datetime.timedelta)
        assert result.total_seconds() == 2 * 3600 + 30 * 60

    def test_interval_days(self):
        result = parse_value(TypeOID.INTERVAL, "5 days")
        assert isinstance(result, datetime.timedelta)
        assert result.days == 5

    def test_interval_days_and_time(self):
        result = parse_value(TypeOID.INTERVAL, "1 day 02:30:00")
        assert isinstance(result, datetime.timedelta)
        assert result.days == 1
        assert result.seconds == 2 * 3600 + 30 * 60


class TestNumericTypes:
    def test_decimal(self):
        result = parse_value(TypeOID.NUMERIC, "123.456")
        assert isinstance(result, decimal.Decimal)
        assert result == decimal.Decimal("123.456")

    def test_decimal_precision(self):
        result = parse_value(TypeOID.NUMERIC, "123456789012345678901234567890.12345")
        assert isinstance(result, decimal.Decimal)
        # Verify precision is maintained
        assert str(result) == "123456789012345678901234567890.12345"

    def test_tinyint(self):
        result = parse_value(TypeOID.TINYINT, "127")
        assert result == 127

    def test_uint8(self):
        result = parse_value(TypeOID.UINT8, "255")
        assert result == 255

    def test_uint16(self):
        result = parse_value(TypeOID.UINT16, "65535")
        assert result == 65535

    def test_uint32(self):
        result = parse_value(TypeOID.UINT32, "4294967295")
        assert result == 4294967295

    def test_uint64(self):
        result = parse_value(TypeOID.UINT64, "18446744073709551615")
        assert result == 18446744073709551615


class TestBinaryTypes:
    def test_bytea_hex(self):
        result = parse_value(TypeOID.BYTEA, "\\xdeadbeef")
        assert isinstance(result, bytes)
        assert result == b"\xde\xad\xbe\xef"

    def test_bytea_plain(self):
        result = parse_value(TypeOID.BYTEA, "hello")
        assert isinstance(result, bytes)
        assert result == b"hello"

    def test_blob_hex(self):
        result = parse_value(TypeOID.BLOB, "\\x48656c6c6f")
        assert isinstance(result, bytes)
        assert result == b"Hello"


class TestStringTypes:
    def test_text(self):
        result = parse_value(TypeOID.TEXT, "hello world")
        assert result == "hello world"

    def test_varchar(self):
        result = parse_value(TypeOID.VARCHAR, "test")
        assert result == "test"

    def test_char(self):
        result = parse_value(TypeOID.CHAR, "A")
        assert result == "A"


class TestAllTypeOIDsDefined:
    """Verify all 22+ type OIDs are defined."""

    def test_all_oids_unique(self):
        oids = [
            TypeOID.BOOL, TypeOID.TINYINT, TypeOID.INT2, TypeOID.INT4, TypeOID.INT8,
            TypeOID.UINT8, TypeOID.UINT16, TypeOID.UINT32, TypeOID.UINT64,
            TypeOID.FLOAT4, TypeOID.FLOAT8, TypeOID.NUMERIC,
            TypeOID.TEXT, TypeOID.VARCHAR, TypeOID.CHAR,
            TypeOID.BYTEA, TypeOID.BLOB,
            TypeOID.DATE, TypeOID.TIME, TypeOID.TIMESTAMP, TypeOID.INTERVAL,
            TypeOID.POINT, TypeOID.JSON, TypeOID.UUID, TypeOID.EMBEDDING,
        ]
        assert len(oids) == len(set(oids))
