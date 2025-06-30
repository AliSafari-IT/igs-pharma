using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using IGS.Domain.Entities;

namespace IGS.Domain.Interfaces
{
    public interface IProductRepository : IRepository<Product>
    {
        Task<IEnumerable<Product>> GetByCategoryIdAsync(int categoryId);
        Task<IEnumerable<Product>> GetBySupplierIdAsync(int supplierId);
        Task<IEnumerable<Product>> SearchAsync(string searchTerm);
        Task<IEnumerable<Product>> GetLowStockAsync();
        Task<IEnumerable<Product>> GetExpiringAsync(DateTime cutoffDate);
    }
}
