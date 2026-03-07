using System.Collections;
using System.Data;
using System.Data.Common;

namespace SixSevenDB.Client;

public sealed class SixSevenDbDataReader : DbDataReader
{
    private readonly QueryResult _result;
    private int _currentRow = -1;
    private bool _closed;

    internal SixSevenDbDataReader(QueryResult result)
    {
        _result = result;
    }

    public override int FieldCount => _result.Fields.Count;
    public override int RecordsAffected => _result.RowCount;
    public override bool HasRows => _result.Rows.Count > 0;
    public override bool IsClosed => _closed;
    public override int Depth => 0;

    public override object this[int ordinal] => GetValue(ordinal);
    public override object this[string name] => GetValue(GetOrdinal(name));

    public override bool Read()
    {
        if (_closed) return false;
        _currentRow++;
        return _currentRow < _result.Rows.Count;
    }

    public override bool NextResult() => false;

    public override void Close()
    {
        _closed = true;
    }

    public override string GetName(int ordinal) => _result.Fields[ordinal].Name;

    public override int GetOrdinal(string name)
    {
        for (var i = 0; i < _result.Fields.Count; i++)
        {
            if (string.Equals(_result.Fields[i].Name, name, StringComparison.OrdinalIgnoreCase))
                return i;
        }
        throw new IndexOutOfRangeException($"Column '{name}' not found");
    }

    public override object GetValue(int ordinal)
    {
        var val = GetCurrentRow()[_result.Fields[ordinal].Name];
        return val ?? DBNull.Value;
    }

    public override int GetValues(object[] values)
    {
        var count = Math.Min(values.Length, FieldCount);
        for (var i = 0; i < count; i++)
        {
            values[i] = GetValue(i);
        }
        return count;
    }

    public override bool IsDBNull(int ordinal)
    {
        return GetCurrentRow()[_result.Fields[ordinal].Name] is null;
    }

    public override bool GetBoolean(int ordinal) => (bool)GetValue(ordinal);
    public override byte GetByte(int ordinal) => Convert.ToByte(GetValue(ordinal));
    public override char GetChar(int ordinal) => Convert.ToChar(GetValue(ordinal));
    public override DateTime GetDateTime(int ordinal) => DateTime.Parse(GetValue(ordinal).ToString()!);
    public override decimal GetDecimal(int ordinal) => (decimal)GetValue(ordinal);
    public override double GetDouble(int ordinal) => Convert.ToDouble(GetValue(ordinal));
    public override float GetFloat(int ordinal) => Convert.ToSingle(GetValue(ordinal));
    public override Guid GetGuid(int ordinal) => (Guid)GetValue(ordinal);
    public override short GetInt16(int ordinal) => (short)GetValue(ordinal);
    public override int GetInt32(int ordinal) => (int)GetValue(ordinal);
    public override long GetInt64(int ordinal) => (long)GetValue(ordinal);
    public override string GetString(int ordinal) => GetValue(ordinal).ToString()!;

    public override string GetDataTypeName(int ordinal)
    {
        var typeOid = _result.Fields[ordinal].DataTypeId;
        return typeOid switch
        {
            TypeOid.Bool => "boolean",
            TypeOid.Int2 => "smallint",
            TypeOid.Int4 => "integer",
            TypeOid.Int8 => "bigint",
            TypeOid.Float4 => "real",
            TypeOid.Float8 => "double precision",
            TypeOid.Numeric => "numeric",
            TypeOid.Text or TypeOid.Varchar => "text",
            TypeOid.Uuid => "uuid",
            TypeOid.Json or TypeOid.Jsonb => "json",
            TypeOid.Embedding => "embedding",
            _ => "text"
        };
    }

    public override Type GetFieldType(int ordinal)
    {
        var typeOid = _result.Fields[ordinal].DataTypeId;
        return typeOid switch
        {
            TypeOid.Bool => typeof(bool),
            TypeOid.Int2 => typeof(short),
            TypeOid.Int4 => typeof(int),
            TypeOid.Int8 => typeof(long),
            TypeOid.Float4 => typeof(float),
            TypeOid.Float8 => typeof(double),
            TypeOid.Numeric => typeof(decimal),
            TypeOid.Uuid => typeof(Guid),
            TypeOid.Embedding => typeof(float[]),
            _ => typeof(string)
        };
    }

    public float[] GetEmbedding(int ordinal)
    {
        var val = GetValue(ordinal);
        return val is float[] embedding ? embedding : throw new InvalidCastException("Column is not an embedding");
    }

    public override long GetBytes(int ordinal, long dataOffset, byte[]? buffer, int bufferOffset, int length)
        => throw new NotSupportedException();

    public override long GetChars(int ordinal, long dataOffset, char[]? buffer, int bufferOffset, int length)
        => throw new NotSupportedException();

    public override IEnumerator GetEnumerator() => new DbEnumerator(this);

    public override DataTable GetSchemaTable()
    {
        var table = new DataTable("SchemaTable");
        table.Columns.Add("ColumnName", typeof(string));
        table.Columns.Add("ColumnOrdinal", typeof(int));
        table.Columns.Add("DataType", typeof(Type));
        table.Columns.Add("DataTypeName", typeof(string));

        for (var i = 0; i < _result.Fields.Count; i++)
        {
            var row = table.NewRow();
            row["ColumnName"] = _result.Fields[i].Name;
            row["ColumnOrdinal"] = i;
            row["DataType"] = GetFieldType(i);
            row["DataTypeName"] = GetDataTypeName(i);
            table.Rows.Add(row);
        }

        return table;
    }

    private Dictionary<string, object?> GetCurrentRow()
    {
        if (_currentRow < 0 || _currentRow >= _result.Rows.Count)
            throw new InvalidOperationException("No current row");
        return _result.Rows[_currentRow];
    }
}
