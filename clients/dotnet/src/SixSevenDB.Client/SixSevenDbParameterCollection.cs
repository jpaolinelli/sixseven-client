using System.Collections;
using System.Data.Common;

namespace SixSevenDB.Client;

public sealed class SixSevenDbParameterCollection : DbParameterCollection
{
    private readonly List<SixSevenDbParameter> _parameters = [];

    public override int Count => _parameters.Count;
    public override object SyncRoot => ((ICollection)_parameters).SyncRoot;

    public new SixSevenDbParameter this[int index]
    {
        get => _parameters[index];
        set => _parameters[index] = value;
    }

    public override int Add(object value)
    {
        _parameters.Add((SixSevenDbParameter)value);
        return _parameters.Count - 1;
    }

    public SixSevenDbParameter Add(string parameterName, object? value)
    {
        var param = new SixSevenDbParameter(parameterName, value);
        _parameters.Add(param);
        return param;
    }

    public override void AddRange(Array values)
    {
        foreach (SixSevenDbParameter param in values)
        {
            _parameters.Add(param);
        }
    }

    public override void Clear() => _parameters.Clear();

    public override bool Contains(object value) => _parameters.Contains((SixSevenDbParameter)value);

    public override bool Contains(string value) => _parameters.Exists(p => p.ParameterName == value);

    public override void CopyTo(Array array, int index) => ((ICollection)_parameters).CopyTo(array, index);

    public override IEnumerator GetEnumerator() => _parameters.GetEnumerator();

    public override int IndexOf(object value) => _parameters.IndexOf((SixSevenDbParameter)value);

    public override int IndexOf(string parameterName) => _parameters.FindIndex(p => p.ParameterName == parameterName);

    public override void Insert(int index, object value) => _parameters.Insert(index, (SixSevenDbParameter)value);

    public override void Remove(object value) => _parameters.Remove((SixSevenDbParameter)value);

    public override void RemoveAt(int index) => _parameters.RemoveAt(index);

    public override void RemoveAt(string parameterName)
    {
        var idx = IndexOf(parameterName);
        if (idx >= 0) _parameters.RemoveAt(idx);
    }

    protected override DbParameter GetParameter(int index) => _parameters[index];
    protected override DbParameter GetParameter(string parameterName) => _parameters[IndexOf(parameterName)];
    protected override void SetParameter(int index, DbParameter value) => _parameters[index] = (SixSevenDbParameter)value;
    protected override void SetParameter(string parameterName, DbParameter value) => _parameters[IndexOf(parameterName)] = (SixSevenDbParameter)value;

    internal object?[] ToValueArray()
    {
        return _parameters.Select(p => p.Value).ToArray();
    }
}
