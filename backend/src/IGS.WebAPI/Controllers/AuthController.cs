using System.ComponentModel.DataAnnotations;
using IGS.Application.DTOs.Auth;
using IGS.Application.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace IGS.WebAPI.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly IUserService _userService;
    private readonly ILogger<AuthController> _logger;

    public AuthController(IUserService userService, ILogger<AuthController> logger)
    {
        _userService = userService;
        _logger = logger;
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterUserDto registerDto)
    {
        try
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(
                    new
                    {
                        message = "Validation failed",
                        errors = ModelState
                            .Values.SelectMany(v => v.Errors)
                            .Select(e => e.ErrorMessage)
                            .ToList(),
                    }
                );
            }

            var result = await _userService.RegisterUserAsync(registerDto);

            _logger.LogInformation("User {Username} registered successfully", registerDto.Username);

            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(
                "Registration failed for {Username}: {Error}",
                registerDto.Username,
                ex.Message
            );
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Unexpected error during registration for {Username}: {Error}",
                registerDto.Username,
                ex.ToString()
            );
            
            // In development environment, return detailed error information
            if (Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") == "Development")
            {
                return StatusCode(500, new { 
                    message = "An error occurred during registration",
                    error = ex.Message,
                    stackTrace = ex.StackTrace,
                    innerException = ex.InnerException?.Message
                });
            }
            
            return StatusCode(500, new { message = "An error occurred during registration" });
        }
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginDto loginDto)
    {
        try
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(new { message = "Invalid login data" });
            }

            var user = await _userService.ValidateCredentialsAsync(
                loginDto.Username,
                loginDto.Password
            );

            if (user == null)
            {
                _logger.LogWarning(
                    "Failed login attempt for username: {Username}",
                    loginDto.Username
                );
                return Unauthorized(new { message = "Invalid credentials" });
            }

            // TODO: Generate JWT token here
            var token = GenerateJwtToken(user);

            _logger.LogInformation("User {Username} logged in successfully", user.Username);

            return Ok(
                new LoginResponseDto
                {
                    Token = token,
                    User = new UserDto
                    {
                        Id = user.Id.ToString(),
                        Username = user.Username,
                        Email = user.Email,
                        FirstName = user.FirstName,
                        LastName = user.LastName,
                        Role = user.Role.ToString(),
                        Department = user.Department,
                        Permissions = user.Permissions,
                        IsActive = user.IsActive,
                    },
                }
            );
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error during login for {Username}", loginDto.Username);
            return StatusCode(500, new { message = "An error occurred during login" });
        }
    }

    [HttpPost("card-login")]
    public async Task<IActionResult> CardLogin([FromBody] CardLoginDto cardLoginDto)
    {
        try
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(new { message = "Invalid card data" });
            }

            // Try to find user by card ID first, then by employee ID
            var user = await _userService.GetUserByCardIdAsync(cardLoginDto.CardData.CardId);
            user ??= await _userService.GetUserByEmployeeIdAsync(cardLoginDto.CardData.EmployeeId);

            if (user == null)
            {
                _logger.LogWarning(
                    "Card login failed - card not recognized: CardId={CardId}, EmployeeId={EmployeeId}",
                    cardLoginDto.CardData.CardId,
                    cardLoginDto.CardData.EmployeeId
                );
                return Unauthorized(new { message = "Card not recognized" });
            }

            // Check if card is expired
            if (user.CardExpiryDate.HasValue && user.CardExpiryDate < DateTime.UtcNow)
            {
                _logger.LogWarning(
                    "Card login failed - card expired for user: {Username}",
                    user.Username
                );
                return Unauthorized(new { message = "Card has expired" });
            }

            // TODO: Generate JWT token here
            var token = GenerateJwtToken(user);

            _logger.LogInformation(
                "User {Username} logged in via card successfully",
                user.Username
            );

            return Ok(
                new LoginResponseDto
                {
                    Token = token,
                    User = new UserDto
                    {
                        Id = user.Id.ToString(),
                        Username = user.Username,
                        Email = user.Email,
                        FirstName = user.FirstName,
                        LastName = user.LastName,
                        Role = user.Role.ToString(),
                        Department = user.Department,
                        Permissions = user.Permissions,
                        IsActive = user.IsActive,
                    },
                }
            );
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error during card login");
            return StatusCode(
                500,
                new { message = "An error occurred during card authentication" }
            );
        }
    }

    [HttpGet("verify")]
    [Authorize]
    public async Task<IActionResult> VerifyToken()
    {
        try
        {
            // TODO: Extract user ID from JWT token
            var userId = GetUserIdFromToken();

            if (string.IsNullOrEmpty(userId))
            {
                return Unauthorized(new { message = "Invalid token" });
            }

            if (!int.TryParse(userId, out int userIdInt))
            {
                return Unauthorized(new { message = "Invalid user ID" });
            }

            var user = await _userService.GetUserByIdAsync(userIdInt);

            if (user == null)
            {
                return Unauthorized(new { message = "User not found" });
            }

            return Ok(
                new
                {
                    valid = true,
                    user = new UserDto
                    {
                        Id = user.Id.ToString(),
                        Username = user.Username,
                        Email = user.Email,
                        FirstName = user.FirstName,
                        LastName = user.LastName,
                        Role = user.Role.ToString(),
                        Department = user.Department,
                        Permissions = user.Permissions,
                        IsActive = user.IsActive,
                    },
                }
            );
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error verifying token");
            return StatusCode(500, new { message = "An error occurred during token verification" });
        }
    }

    // Validation endpoints for registration form
    [HttpGet("check-username/{username}")]
    public async Task<IActionResult> CheckUsernameAvailability(string username)
    {
        try
        {
            var isAvailable = await _userService.IsUsernameAvailableAsync(username);
            return Ok(new { available = isAvailable });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking username availability");
            return StatusCode(500, new { message = "Error checking username availability" });
        }
    }

    [HttpGet("check-email/{email}")]
    public async Task<IActionResult> CheckEmailAvailability(string email)
    {
        try
        {
            var isAvailable = await _userService.IsEmailAvailableAsync(email);
            return Ok(new { available = isAvailable });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking email availability");
            return StatusCode(500, new { message = "Error checking email availability" });
        }
    }

    [HttpGet("check-employee-id/{employeeId}")]
    public async Task<IActionResult> CheckEmployeeIdAvailability(string employeeId)
    {
        try
        {
            var isAvailable = await _userService.IsEmployeeIdAvailableAsync(employeeId);
            return Ok(new { available = isAvailable });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking employee ID availability");
            return StatusCode(500, new { message = "Error checking employee ID availability" });
        }
    }

    // TODO: Implement JWT token generation and validation
    private string GenerateJwtToken(IGS.Domain.Entities.User user)
    {
        // Placeholder - implement JWT token generation
        return $"jwt-token-for-{user.Username}-{DateTime.UtcNow.Ticks}";
    }

    private string? GetUserIdFromToken()
    {
        // Placeholder - extract user ID from JWT token
        return "placeholder-user-id";
    }
}

// Supporting DTOs
public class LoginDto
{
    [Required]
    public string Username { get; set; } = string.Empty;

    [Required]
    public string Password { get; set; } = string.Empty;
}

public class CardLoginDto
{
    [Required]
    public CardDataDto CardData { get; set; } = new();
}

public class CardDataDto
{
    public string CardId { get; set; } = string.Empty;
    public string EmployeeId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Department { get; set; } = string.Empty;
    public DateTime? ExpiryDate { get; set; }
    public string AccessLevel { get; set; } = string.Empty;
}

public class LoginResponseDto
{
    public string Token { get; set; } = string.Empty;
    public UserDto User { get; set; } = new();
}

public class UserDto
{
    public string Id { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string? Department { get; set; }
    public List<string> Permissions { get; set; } = new();
    public bool IsActive { get; set; }
}
