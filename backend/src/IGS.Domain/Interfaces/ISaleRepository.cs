using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using IGS.Domain.Entities;

namespace IGS.Domain.Interfaces
{
    public interface ISaleRepository : IRepository<Sale>
    {
        Task<IEnumerable<Sale>> GetByCustomerIdAsync(int customerId);
        Task<IEnumerable<Sale>> GetByUserIdAsync(int userId);
        Task<IEnumerable<Sale>> GetByDateRangeAsync(DateTime startDate, DateTime endDate);
        Task<IEnumerable<Sale>> GetWithItemsAsync();
        Task<Sale?> GetWithItemsAsync(int id);
    }
}
