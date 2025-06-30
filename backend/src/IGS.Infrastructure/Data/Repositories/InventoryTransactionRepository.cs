using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using IGS.Domain.Entities;
using IGS.Domain.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace IGS.Infrastructure.Data.Repositories
{
    public class InventoryTransactionRepository
        : Repository<InventoryTransaction>,
            IInventoryTransactionRepository
    {
        public InventoryTransactionRepository(PharmacyDbContext context)
            : base(context) { }

        public async Task<IEnumerable<InventoryTransaction>> GetByProductIdAsync(int productId)
        {
            return await _context
                .InventoryTransactions.Where(t => t.ProductId == productId)
                .OrderByDescending(t => t.TransactionDate)
                .ToListAsync();
        }

        public async Task<IEnumerable<InventoryTransaction>> GetByUserIdAsync(int userId)
        {
            return await _context
                .InventoryTransactions.Where(t => t.UserId == userId)
                .OrderByDescending(t => t.TransactionDate)
                .ToListAsync();
        }

        public async Task<IEnumerable<InventoryTransaction>> GetByDateRangeAsync(
            DateTime startDate,
            DateTime endDate
        )
        {
            return await _context
                .InventoryTransactions.Where(t =>
                    t.TransactionDate >= startDate && t.TransactionDate <= endDate
                )
                .OrderByDescending(t => t.TransactionDate)
                .ToListAsync();
        }
    }
}
