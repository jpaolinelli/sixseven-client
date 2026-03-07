using Microsoft.EntityFrameworkCore.Update;

namespace SixSevenDB.EntityFrameworkCore;

public class SixSevenDbModificationCommandBatchFactory : IModificationCommandBatchFactory
{
    private readonly ModificationCommandBatchFactoryDependencies _dependencies;

    public SixSevenDbModificationCommandBatchFactory(ModificationCommandBatchFactoryDependencies dependencies)
    {
        _dependencies = dependencies;
    }

    public ModificationCommandBatch Create()
    {
        return new SingularModificationCommandBatch(_dependencies);
    }
}
