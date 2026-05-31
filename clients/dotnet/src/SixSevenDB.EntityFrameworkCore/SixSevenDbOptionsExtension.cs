using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

namespace SixSevenDB.EntityFrameworkCore;

public class SixSevenDbOptionsExtension : RelationalOptionsExtension
{
    private DbContextOptionsExtensionInfo? _info;

    public SixSevenDbOptionsExtension() { }

    protected SixSevenDbOptionsExtension(SixSevenDbOptionsExtension copyFrom) : base(copyFrom) { }

    public override DbContextOptionsExtensionInfo Info => _info ??= new ExtensionInfo(this);

    protected override RelationalOptionsExtension Clone() => new SixSevenDbOptionsExtension(this);

    public override void ApplyServices(IServiceCollection services)
    {
        services.AddEntityFrameworkSixSevenDb();
    }

    private sealed class ExtensionInfo : RelationalExtensionInfo
    {
        public ExtensionInfo(IDbContextOptionsExtension extension) : base(extension) { }

        public override bool IsDatabaseProvider => true;

        public override string LogFragment => "Using SixSevenDB ";

        public override int GetServiceProviderHashCode() => (Extension as SixSevenDbOptionsExtension)?.ConnectionString?.GetHashCode() ?? 0;

        public override bool ShouldUseSameServiceProvider(DbContextOptionsExtensionInfo other) => other is ExtensionInfo;

        public override void PopulateDebugInfo(IDictionary<string, string> debugInfo)
        {
            debugInfo["SixSevenDB:ConnectionString"] = (Extension as SixSevenDbOptionsExtension)?.ConnectionString ?? "";
        }
    }
}
