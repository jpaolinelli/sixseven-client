"""Tests for public API surface and DB-API 2.0 module-level attributes."""

import giodb


class TestDBAPI2ModuleAttributes:
    def test_apilevel(self):
        assert giodb.apilevel == "2.0"

    def test_threadsafety(self):
        assert giodb.threadsafety == 2

    def test_paramstyle(self):
        assert giodb.paramstyle == "numeric"

    def test_connect_function(self):
        assert callable(giodb.connect)


class TestExportedClasses:
    def test_client(self):
        assert hasattr(giodb, "Client")

    def test_connection(self):
        assert hasattr(giodb, "Connection")

    def test_async_connection(self):
        assert hasattr(giodb, "AsyncConnection")

    def test_cursor(self):
        assert hasattr(giodb, "Cursor")

    def test_pool(self):
        assert hasattr(giodb, "Pool")

    def test_pool_client(self):
        assert hasattr(giodb, "PoolClient")


class TestExportedTypes:
    def test_connection_config(self):
        config = giodb.ConnectionConfig(host="localhost", port=6767)
        assert config.host == "localhost"

    def test_pool_config(self):
        config = giodb.PoolConfig(max_size=20)
        assert config.max_size == 20

    def test_query_result(self):
        assert hasattr(giodb, "QueryResult")

    def test_field_info(self):
        assert hasattr(giodb, "FieldInfo")

    def test_traverse_options(self):
        opts = giodb.TraverseOptions(direction="OUT", max_depth=3)
        assert opts.direction == "OUT"

    def test_nearest_options(self):
        opts = giodb.NearestOptions(k=5, metric="COSINE")
        assert opts.k == 5

    def test_link_options(self):
        opts = giodb.LinkOptions(properties={"key": "value"})
        assert opts.properties == {"key": "value"}

    def test_defaults(self):
        assert giodb.DEFAULTS["host"] == "localhost"
        assert giodb.DEFAULTS["port"] == 6767
        assert giodb.DEFAULTS["user"] == "sixseven"
        assert giodb.DEFAULTS["database"] == "sixseven"


class TestExportedFunctions:
    def test_query_builders(self):
        assert callable(giodb.build_traverse)
        assert callable(giodb.build_nearest)
        assert callable(giodb.build_link)
        assert callable(giodb.build_unlink)
        assert callable(giodb.escape_identifier)

    def test_type_parser(self):
        assert callable(giodb.parse_value)
        assert callable(giodb.parse_embedding)
        assert callable(giodb.serialize_embedding)

    def test_type_oid(self):
        assert giodb.TypeOID.BOOL == 16
        assert giodb.TypeOID.EMBEDDING == 100000


class TestExportedExceptions:
    def test_exception_hierarchy(self):
        assert issubclass(giodb.Warning, Exception)
        assert issubclass(giodb.Error, Exception)
        assert issubclass(giodb.InterfaceError, giodb.Error)
        assert issubclass(giodb.DatabaseError, giodb.Error)
        assert issubclass(giodb.DataError, giodb.DatabaseError)
        assert issubclass(giodb.OperationalError, giodb.DatabaseError)
        assert issubclass(giodb.IntegrityError, giodb.DatabaseError)
        assert issubclass(giodb.InternalError, giodb.DatabaseError)
        assert issubclass(giodb.ProgrammingError, giodb.DatabaseError)
        assert issubclass(giodb.NotSupportedError, giodb.DatabaseError)
