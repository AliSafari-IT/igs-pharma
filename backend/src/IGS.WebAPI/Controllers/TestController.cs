using IGS.Application.Interfaces;
using IGS.Domain.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace IGS.WebAPI.Controllers;

[ApiController]
[Route("api/[controller]")]
public class TestController : ControllerBase
{
    private readonly IProductService _productService;
    private readonly IProductRepository _productRepository;
    private readonly IInventoryTransactionRepository _inventoryTransactionRepository;
    private readonly ILogger<TestController> _logger;

    public TestController(
        IProductService productService,
        IProductRepository productRepository,
        IInventoryTransactionRepository inventoryTransactionRepository,
        ILogger<TestController> logger
    )
    {
        _productService = productService;
        _productRepository = productRepository;
        _inventoryTransactionRepository = inventoryTransactionRepository;
        _logger = logger;
    }

    [HttpGet("inventory-test/{productId}")]
    public async Task<IActionResult> TestInventoryTransaction(int productId)
    {
        try
        {
            // Get current product
            var product = await _productRepository.GetByIdAsync(productId);
            if (product == null)
                return NotFound($"Product with ID {productId} not found");

            // Log initial state
            _logger.LogInformation(
                $"Initial stock for product {productId}: {product.StockQuantity}"
            );

            // Update stock (add 10 units)
            var updateResult = await _productService.UpdateStockAsync(
                productId,
                10,
                "Test stock addition"
            );
            if (!updateResult)
                return BadRequest("Failed to update stock");

            // Get updated product
            product = await _productRepository.GetByIdAsync(productId);
            _logger.LogInformation(
                $"Updated stock for product {productId}: {product.StockQuantity}"
            );

            // Get transaction history
            var transactions = await _inventoryTransactionRepository.GetByProductIdAsync(productId);

            return Ok(new { Product = product, Transactions = transactions });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error testing inventory transaction");
            return StatusCode(500, "An error occurred while testing inventory transaction");
        }
    }
}
