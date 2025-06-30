using System.Collections.Generic;
using System.Threading.Tasks;
using IGS.Domain.Entities;

namespace IGS.Domain.Interfaces
{
    public interface ICategoryRepository : IRepository<Category>
    {
        Task<IEnumerable<Category>> GetAllWithProductsAsync();
        Task<Category?> GetByIdWithProductsAsync(int id);
    }
}
