using System.Collections.Generic;
using System.Threading.Tasks;
using IGS.Domain.Entities;
using IGS.Domain.Interfaces;
using IGS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace IGS.Infrastructure.Data.Repositories
{
    public class SupplierRepository : Repository<Supplier>, ISupplierRepository
    {
        private readonly new PharmacyDbContext _context;

        public SupplierRepository(PharmacyDbContext context) : base(context)
        {
            _context = context;
        }

        public override async Task UpdateAsync(Supplier entity)
        {
            entity.UpdatedAt = DateTime.UtcNow;
            await base.UpdateAsync(entity);
        }
    }
}
