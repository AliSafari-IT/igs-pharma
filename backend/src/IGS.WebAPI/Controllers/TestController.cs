using IGS.Application.DTOs.Auth;
using IGS.Application.Interfaces;
using IGS.Domain.Entities;
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
    private readonly IUserService _userService;
    private readonly ILogger<TestController> _logger;

    public TestController(
        IProductService productService,
        IProductRepository productRepository,
        IInventoryTransactionRepository inventoryTransactionRepository,
        IUserService userService,
        ILogger<TestController> logger
    )
    {
        _productService = productService;
        _productRepository = productRepository;
        _inventoryTransactionRepository = inventoryTransactionRepository;
        _userService = userService;
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
                $"Updated stock for product {productId}: {product?.StockQuantity}"
            );

            // Get transaction history
            var transactions = await _inventoryTransactionRepository.GetByProductIdAsync(productId);
            _logger.LogInformation(
                $"Found {transactions.Count()} transactions for product {productId}"
            );

            return Ok(
                new
                {
                    success = true,
                    message = $"Stock updated for product {productId}",
                    currentStock = product?.StockQuantity,
                    transactionCount = transactions.Count(),
                }
            );
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"Error in test endpoint for product {productId}");
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpGet("users-debug")]
    public async Task<IActionResult> TestGetUsers()
    {
        try
        {
            _logger.LogInformation("Debug: Fetching all users");

            // Get users directly from the service
            var users = await _userService.GetAllUsersAsync();

            // Log the count and basic info
            _logger.LogInformation($"Debug: Found {users.Count()} users");

            // Create a simplified response without potential circular references
            var simplifiedUsers = users
                .Select(u => new
                {
                    Id = u.Id,
                    Username = u.Username,
                    Email = u.Email,
                    Role = u.Role.ToString(),
                    PermissionCount = u.Permissions?.Count ?? 0,
                })
                .ToList();

            return Ok(
                new
                {
                    success = true,
                    count = simplifiedUsers.Count,
                    users = simplifiedUsers,
                }
            );
        }
        catch (Exception ex)
        {
            // Log the detailed exception
            _logger.LogError(ex, "Debug: Error fetching users");

            // Return a detailed error response
            return StatusCode(
                500,
                new
                {
                    success = false,
                    message = ex.Message,
                    stackTrace = ex.StackTrace,
                    innerException = ex.InnerException?.Message,
                }
            );
        }
    }
}
