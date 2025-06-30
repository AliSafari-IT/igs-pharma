using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using IGS.Domain.Entities;
using IGS.Domain.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace IGS.Infrastructure.Data.Repositories
{
    public class ProductRepository : Repository<Product>, IProductRepository
    {
        private readonly new PharmacyDbContext _context;

        public ProductRepository(PharmacyDbContext context) : base(context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Product>> GetByCategoryIdAsync(int categoryId)
        {
            return await _context.Products
                .Where(p => p.CategoryId == categoryId && p.IsActive)
                .ToListAsync();
        }

        public async Task<IEnumerable<Product>> GetBySupplierIdAsync(int supplierId)
        {
            return await _context.Products
                .Where(p => p.SupplierId == supplierId && p.IsActive)
                .ToListAsync();
        }

        public async Task<IEnumerable<Product>> SearchAsync(string searchTerm)
        {
            return await _context.Products
                .Include(p => p.Category)
                .Include(p => p.Supplier)
                .Where(p => p.IsActive && 
                           (p.Name.Contains(searchTerm) || 
                            p.Description.Contains(searchTerm) ||
                            p.SKU.Contains(searchTerm) ||
                            p.Barcode.Contains(searchTerm) ||
                            p.Manufacturer.Contains(searchTerm)))
                .ToListAsync();
        }

        public async Task<IEnumerable<Product>> GetLowStockAsync()
        {
            return await _context.Products
                .Include(p => p.Category)
                .Include(p => p.Supplier)
                .Where(p => p.IsActive && p.StockQuantity <= p.MinStockLevel)
                .ToListAsync();
        }

        public async Task<IEnumerable<Product>> GetExpiringAsync(DateTime cutoffDate)
        {
            return await _context.Products
                .Include(p => p.Category)
                .Include(p => p.Supplier)
                .Where(p => p.IsActive && 
                           p.ExpiryDate.HasValue && 
                           p.ExpiryDate.Value <= cutoffDate)
                .ToListAsync();
        }
    }
}
