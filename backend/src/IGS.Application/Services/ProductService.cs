using AutoMapper;
using IGS.Application.DTOs;
using IGS.Application.Interfaces;
using IGS.Domain.Entities;
using IGS.Domain.Interfaces;

namespace IGS.Application.Services;

public class ProductService : IProductService
{
    private readonly IProductRepository _productRepository;
    private readonly ICategoryRepository _categoryRepository;
    private readonly ISupplierRepository _supplierRepository;
    private readonly IInventoryTransactionRepository _inventoryTransactionRepository;
    private readonly IMapper _mapper;

    public ProductService(
        IProductRepository productRepository,
        ICategoryRepository categoryRepository,
        ISupplierRepository supplierRepository,
        IInventoryTransactionRepository inventoryTransactionRepository,
        IMapper mapper
    )
    {
        _productRepository = productRepository;
        _categoryRepository = categoryRepository;
        _supplierRepository = supplierRepository;
        _inventoryTransactionRepository = inventoryTransactionRepository;
        _mapper = mapper;
    }

    public async Task<IEnumerable<ProductDto>> GetAllProductsAsync()
    {
        var products = await _productRepository.GetAllAsync();
        var activeProducts = products.Where(p => p.IsActive).OrderBy(p => p.Name);

        return _mapper.Map<IEnumerable<ProductDto>>(activeProducts);
    }

    public async Task<ProductDto?> GetProductByIdAsync(int id)
    {
        var product = await _productRepository.GetByIdAsync(id);

        if (product == null || !product.IsActive)
            return null;

        return _mapper.Map<ProductDto>(product);
    }

    public async Task<IEnumerable<ProductDto>> GetProductsByCategoryAsync(int categoryId)
    {
        var products = await _productRepository.GetByCategoryIdAsync(categoryId);
        var activeProducts = products.Where(p => p.IsActive).OrderBy(p => p.Name);

        return _mapper.Map<IEnumerable<ProductDto>>(activeProducts);
    }

    public async Task<IEnumerable<ProductDto>> SearchProductsAsync(string searchTerm)
    {
        var products = await _productRepository.SearchAsync(searchTerm);
        var activeProducts = products.Where(p => p.IsActive).OrderBy(p => p.Name);

        return _mapper.Map<IEnumerable<ProductDto>>(activeProducts);
    }

    public async Task<IEnumerable<ProductDto>> GetLowStockProductsAsync()
    {
        var products = await _productRepository.GetLowStockAsync();
        var activeProducts = products.Where(p => p.IsActive).OrderBy(p => p.StockQuantity);

        return _mapper.Map<IEnumerable<ProductDto>>(activeProducts);
    }

    public async Task<IEnumerable<ProductDto>> GetExpiringProductsAsync(int days = 30)
    {
        var cutoffDate = DateTime.Now.AddDays(days);
        var products = await _productRepository.GetExpiringAsync(cutoffDate);
        var activeProducts = products.Where(p => p.IsActive).OrderBy(p => p.ExpiryDate);

        return _mapper.Map<IEnumerable<ProductDto>>(activeProducts);
    }

    public async Task<ProductDto> CreateProductAsync(CreateProductDto createProductDto)
    {
        var product = _mapper.Map<Product>(createProductDto);
        product.CreatedAt = DateTime.UtcNow;
        product.UpdatedAt = DateTime.UtcNow;

        await _productRepository.AddAsync(product);

        return await GetProductByIdAsync(product.Id)
            ?? throw new InvalidOperationException("Failed to create product");
    }

    public async Task<ProductDto> UpdateProductAsync(int id, UpdateProductDto updateProductDto)
    {
        var product = await _productRepository.GetByIdAsync(id);
        if (product == null)
            throw new ArgumentException("Product not found");

        _mapper.Map(updateProductDto, product);
        product.UpdatedAt = DateTime.UtcNow;

        await _productRepository.UpdateAsync(product);

        return await GetProductByIdAsync(id)
            ?? throw new InvalidOperationException("Failed to update product");
    }

    public async Task<bool> DeleteProductAsync(int id)
    {
        var product = await _productRepository.GetByIdAsync(id);
        if (product == null)
            return false;

        product.IsActive = false;
        product.UpdatedAt = DateTime.UtcNow;

        await _productRepository.UpdateAsync(product);
        return true;
    }

    public async Task<bool> UpdateStockAsync(int productId, int quantity, string reason)
    {
        var product = await _productRepository.GetByIdAsync(productId);
        if (product == null)
            return false;

        // Check if we have enough stock for stock out
        if (quantity < 0 && product.StockQuantity + quantity < 0)
            return false;

        var previousStock = product.StockQuantity;
        product.StockQuantity += quantity;
        product.UpdatedAt = DateTime.UtcNow;

        // Create inventory transaction
        var transaction = new InventoryTransaction
        {
            ProductId = productId,
            Type =
                quantity > 0 ? InventoryTransactionType.StockIn : InventoryTransactionType.StockOut,
            Quantity = Math.Abs(quantity),
            PreviousStock = previousStock,
            NewStock = product.StockQuantity,
            Reason = reason,
            UserId = 1, // TODO: Get from current user context
            TransactionDate = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow,
        };

        // Update product and add transaction
        await _productRepository.UpdateAsync(product);
        await _inventoryTransactionRepository.AddAsync(transaction);

        return true;
    }
}
