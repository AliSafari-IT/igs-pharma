using System.Collections.Generic;
using System.Threading.Tasks;
using IGS.Domain.Entities;

namespace IGS.Domain.Interfaces
{
    public interface ISupplierRepository : IRepository<Supplier>
    {
        // Add any supplier-specific repository methods here
    }
}
