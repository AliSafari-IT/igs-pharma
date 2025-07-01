using System.Collections.Generic;
using System.Threading.Tasks;
using IGS.Domain.Entities;
using IGS.Domain.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace IGS.Infrastructure.Data.Repositories
{
    public class CategoryRepository : Repository<Category>, ICategoryRepository
    {
        private readonly PharmacyDbContext _context;

        public CategoryRepository(PharmacyDbContext context)
            : base(context)
        {
            _context = context;
        }
        
        public override async Task<IEnumerable<Category>> GetAllAsync()
        {
            // Explicitly disable lazy loading to avoid circular reference issues
            var lazyLoadingEnabled = _context.ChangeTracker.LazyLoadingEnabled;
            _context.ChangeTracker.LazyLoadingEnabled = false;
            
            try
            {
                return await _context.Categories.AsNoTracking().ToListAsync();
            }
            finally
            {
                // Restore original lazy loading setting
                _context.ChangeTracker.LazyLoadingEnabled = lazyLoadingEnabled;
            }
        }

        public async Task<IEnumerable<Category>> GetAllWithProductsAsync()
        {
            return await _context.Categories.Include(c => c.Products).ToListAsync();
        }

        public async Task<Category?> GetByIdWithProductsAsync(int id)
        {
            return await _context
                .Categories.Include(c => c.Products)
                .FirstOrDefaultAsync(c => c.Id == id);
        }
    }
}
