"""Tests for SHOW/EXPLAIN helpers, edge type DDL, and connection URI parsing."""

from __future__ import annotations

import pytest

from giodb.helpers import (
    create_edge_type_sql,
    drop_edge_type_sql,
    explain_analyze_sql,
    explain_sql,
    parse_connection_uri,
    show_columns_sql,
    show_databases_sql,
    show_edge_types_sql,
    show_embeddings_sql,
    show_indexes_sql,
    show_providers_sql,
    show_tables_sql,
)


class TestShowHelpers:
    def test_show_databases(self):
        assert show_databases_sql() == "SHOW DATABASES"

    def test_show_tables(self):
        assert show_tables_sql() == "SHOW TABLES"

    def test_show_columns(self):
        assert show_columns_sql("users") == 'SHOW COLUMNS FROM "users"'

    def test_show_columns_escaped(self):
        assert show_columns_sql('my"table') == 'SHOW COLUMNS FROM "my""table"'

    def test_show_edge_types(self):
        assert show_edge_types_sql() == "SHOW EDGE TYPES"

    def test_show_indexes(self):
        assert show_indexes_sql() == "SHOW INDEXES"

    def test_show_embeddings(self):
        assert show_embeddings_sql() == "SHOW EMBEDDINGS"

    def test_show_providers(self):
        assert show_providers_sql() == "SHOW PROVIDERS"


class TestExplainHelpers:
    def test_explain(self):
        assert explain_sql("SELECT 1") == "EXPLAIN SELECT 1"

    def test_explain_analyze(self):
        assert explain_analyze_sql("SELECT 1") == "EXPLAIN ANALYZE SELECT 1"


class TestEdgeTypeDDL:
    def test_create_basic(self):
        sql = create_edge_type_sql("follows", "users", "users")
        assert sql == 'CREATE EDGE TYPE "follows" FROM "users" TO "users"'

    def test_create_with_properties(self):
        sql = create_edge_type_sql(
            "rated", "users", "products", properties={"score": "FLOAT", "comment": "TEXT"}
        )
        assert 'CREATE EDGE TYPE "rated"' in sql
        assert '"score" FLOAT' in sql
        assert '"comment" TEXT' in sql

    def test_drop_basic(self):
        sql = drop_edge_type_sql("follows")
        assert sql == 'DROP EDGE TYPE "follows"'

    def test_drop_if_exists(self):
        sql = drop_edge_type_sql("follows", if_exists=True)
        assert sql == 'DROP EDGE TYPE IF EXISTS "follows"'


class TestParseConnectionUri:
    def test_full_uri(self):
        config = parse_connection_uri("sixseven://admin:secret@db.example.com:9999/mydb")
        assert config.host == "db.example.com"
        assert config.port == 9999
        assert config.user == "admin"
        assert config.password == "secret"
        assert config.database == "mydb"

    def test_minimal_uri(self):
        config = parse_connection_uri("sixseven://localhost")
        assert config.host == "localhost"
        assert config.port == 6767
        assert config.user == "sixseven"
        assert config.password is None
        assert config.database == "sixseven"

    def test_user_only(self):
        config = parse_connection_uri("sixseven://myuser@localhost")
        assert config.user == "myuser"
        assert config.password is None

    def test_with_port(self):
        config = parse_connection_uri("sixseven://localhost:5432")
        assert config.port == 5432

    def test_with_database(self):
        config = parse_connection_uri("sixseven://localhost/testdb")
        assert config.database == "testdb"

    def test_postgresql_scheme(self):
        config = parse_connection_uri("postgresql://user:pass@host:5432/db")
        assert config.host == "host"
        assert config.port == 5432

    def test_invalid_scheme(self):
        with pytest.raises(ValueError, match="Unsupported URI scheme"):
            parse_connection_uri("mysql://localhost/db")

    def test_no_path_uses_default_db(self):
        config = parse_connection_uri("sixseven://localhost")
        assert config.database == "sixseven"

    def test_root_path_uses_default_db(self):
        config = parse_connection_uri("sixseven://localhost/")
        assert config.database == "sixseven"
