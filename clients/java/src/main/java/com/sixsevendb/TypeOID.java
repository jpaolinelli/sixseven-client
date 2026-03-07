package com.sixsevendb;

/**
 * Type OID constants matching the server's pg_type catalog.
 */
public final class TypeOID {

    public static final int BOOL      = 16;
    public static final int TINYINT   = 18;
    public static final int INT2      = 21;
    public static final int INT4      = 23;
    public static final int INT8      = 20;
    public static final int UINT8     = 100001;
    public static final int UINT16    = 100002;
    public static final int UINT32    = 100003;
    public static final int UINT64    = 100004;
    public static final int FLOAT4    = 700;
    public static final int FLOAT8    = 701;
    public static final int NUMERIC   = 1700;
    public static final int TEXT      = 25;
    public static final int VARCHAR   = 1043;
    public static final int CHAR      = 1042;
    public static final int BYTEA     = 17;
    public static final int BLOB      = 100005;
    public static final int DATE      = 1082;
    public static final int TIME      = 1083;
    public static final int TIMESTAMP = 1114;
    public static final int INTERVAL  = 1186;
    public static final int POINT     = 600;
    public static final int JSON      = 114;
    public static final int UUID      = 2950;
    public static final int EMBEDDING = 100000;

    private TypeOID() {}
}
