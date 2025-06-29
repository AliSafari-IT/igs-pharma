using AutoMapper;
using IGS.Application.DTOs;
using IGS.Application.Interfaces;
using IGS.Domain.Entities;
using IGS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace IGS.Application.Services;

public class ProductService : IProductService
{
    private readonly PharmacyDbContext _context;
    private readonly IMapper _mapper;

    public ProductService(PharmacyDbContext context, IMapper mapper)
    {
        _context = context;
        _mapper = mapper;
    }

    public async Task<IEnumerable<ProductDto>> GetAllProductsAsync()
    {
        var products = await _context.Products
            .Include(p => p.Category)
            .Include(p => p.Supplier)
            .Where(p => p.IsActive)
            .OrderBy(p => p.Name)
            .ToListAsync();

        return _mapper.Map<IEnumerable<ProductDto>>(products);
    }

    public async Task<ProductDto?> GetProductByIdAsync(int id)
    {
        var product = await _context.Products
            .Include(p => p.Category)
            .Include(p => p.Supplier)
            .FirstOrDefaultAsync(p => p.Id == id && p.IsActive);

        return product != null ? _mapper.Map<ProductDto>(product) : null;
    }

    public async Task<IEnumerable<ProductDto>> GetProductsByCategoryAsync(int categoryId)
    {
        var products = await _context.Products
            .Include(p => p.Category)
            .Include(p => p.Supplier)
            .Where(p => p.CategoryId == categoryId && p.IsActive)
            .OrderBy(p => p.Name)
            .ToListAsync();

        return _mapper.Map<IEnumerable<ProductDto>>(products);
    }

    public async Task<IEnumerable<ProductDto>> SearchProductsAsync(string searchTerm)
    {
        var products = await _context.Products
            .Include(p => p.Category)
            .Include(p => p.Supplier)
            .Where(p => p.IsActive && 
                       (p.Name.Contains(searchTerm) || 
                        p.Description.Contains(searchTerm) ||
                        p.SKU.Contains(searchTerm) ||
                        p.Barcode.Contains(searchTerm) ||
                        p.Manufacturer.Contains(searchTerm)))
            .OrderBy(p => p.Name)
            .ToListAsync();

        return _mapper.Map<IEnumerable<ProductDto>>(products);
    }

    public async Task<IEnumerable<ProductDto>> GetLowStockProductsAsync()
    {
        var products = await _context.Products
            .Include(p => p.Category)
            .Include(p => p.Supplier)
            .Where(p => p.IsActive && p.StockQuantity <= p.MinStockLevel)
            .OrderBy(p => p.StockQuantity)
            .ToListAsync();

        return _mapper.Map<IEnumerable<ProductDto>>(products);
    }

    public async Task<IEnumerable<ProductDto>> GetExpiringProductsAsync(int days = 30)
    {
        var cutoffDate = DateTime.Now.AddDays(days);
        var products = await _context.Products
            .Include(p => p.Category)
            .Include(p => p.Supplier)
            .Where(p => p.IsActive && 
                       p.ExpiryDate.HasValue && 
                       p.ExpiryDate.Value <= cutoffDate)
            .OrderBy(p => p.ExpiryDate)
            .ToListAsync();

        return _mapper.Map<IEnumerable<ProductDto>>(products);
    }

    public async Task<ProductDto> CreateProductAsync(CreateProductDto createProductDto)
    {
        var product = _mapper.Map<Product>(createProductDto);
        product.CreatedAt = DateTime.UtcNow;
        product.UpdatedAt = DateTime.UtcNow;

        _context.Products.Add(product);
        await _context.SaveChangesAsync();

        return await GetProductByIdAsync(product.Id) ?? throw new InvalidOperationException("Failed to create product");
    }

    public async Task<ProductDto> UpdateProductAsync(int id, UpdateProductDto updateProductDto)
    {
        var product = await _context.Products.FindAsync(id);
        if (product == null)
            throw new ArgumentException("Product not found");

        _mapper.Map(updateProductDto, product);
        product.UpdatedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync();

        return await GetProductByIdAsync(id) ?? throw new InvalidOperationException("Failed to update product");
    }

    public async Task<bool> DeleteProductAsync(int id)
    {
        var product = await _context.Products.FindAsync(id);
        if (product == null)
            return false;

        product.IsActive = false;
        product.UpdatedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<bool> UpdateStockAsync(int productId, int quantity, string reason)
    {
        var product = await _context.Products.FindAsync(productId);
        if (product == null)
            return false;

        var previousStock = product.StockQuantity;
        product.StockQuantity += quantity;
        product.UpdatedAt = DateTime.UtcNow;

        // Create inventory transaction
        var transaction = new InventoryTransaction
        {
            ProductId = productId,
            Type = quantity > 0 ? InventoryTransactionType.StockIn : InventoryTransactionType.StockOut,
            Quantity = Math.Abs(quantity),
            PreviousStock = previousStock,
            NewStock = product.StockQuantity,
            Reason = reason,
            UserId = 1, // TODO: Get from current user context
            TransactionDate = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };

        _context.InventoryTransactions.Add(transaction);
        await _context.SaveChangesAsync();

        return true;
    }
}
