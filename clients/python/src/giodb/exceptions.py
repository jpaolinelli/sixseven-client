"""DB-API 2.0 (PEP 249) exception hierarchy for GioDB."""


class Warning(Exception):
    """Exception raised for important warnings."""


class Error(Exception):
    """Base class for all GioDB errors."""


class InterfaceError(Error):
    """Exception raised for errors related to the database interface."""


class DatabaseError(Error):
    """Exception raised for errors related to the database."""


class DataError(DatabaseError):
    """Exception raised for errors due to problems with processed data."""


class OperationalError(DatabaseError):
    """Exception raised for errors related to the database's operation."""


class IntegrityError(DatabaseError):
    """Exception raised when the relational integrity of the database is affected."""


class InternalError(DatabaseError):
    """Exception raised when the database encounters an internal error."""


class ProgrammingError(DatabaseError):
    """Exception raised for programming errors (e.g., bad SQL syntax)."""


class NotSupportedError(DatabaseError):
    """Exception raised for unsupported features."""
