using System.ComponentModel.DataAnnotations;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using IGS.Application.DTOs.Auth;
using IGS.Application.Interfaces;
using IGS.Domain.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Tokens;

namespace IGS.WebAPI.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly IUserService _userService;
    private readonly ILogger<AuthController> _logger;
    private readonly IConfiguration _configuration;

    public AuthController(
        IUserService userService,
        ILogger<AuthController> logger,
        IConfiguration configuration
    )
    {
        _userService = userService;
        _logger = logger;
        _configuration = configuration;
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
                return StatusCode(
                    500,
                    new
                    {
                        message = "An error occurred during registration",
                        error = ex.Message,
                        stackTrace = ex.StackTrace,
                        innerException = ex.InnerException?.Message,
                    }
                );
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
                    isValid = true, // Changed from 'valid' to 'isValid' to match frontend expectation
                    user = new
                    {
                        id = user.Id.ToString(),
                        username = user.Username,
                        email = user.Email,
                        firstName = user.FirstName,
                        lastName = user.LastName,
                        role = user.Role.ToString(),
                        department = user.Department,
                        phoneNumber = user.Phone,
                        employeeId = user.EmployeeId,
                        permissions = user.Permissions ?? new List<string>(),
                        isActive = user.IsActive,
                    },
                }
            );
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error verifying token");
            return StatusCode(500, new { message = "An error occurred while verifying the token" });
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

    private string GenerateJwtToken(IGS.Domain.Entities.User user)
    {
        var tokenHandler = new JwtSecurityTokenHandler();
        var key = Encoding.ASCII.GetBytes(
            _configuration["Jwt:Key"]
                ?? "your-256-bit-secret-key-here-make-this-secure-in-production"
        );

        // Create a list of claims starting with the basic user information
        var claims = new List<Claim>
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Role, user.Role.ToString()),
        };

        // Add all user permissions as claims
        if (user.Permissions != null)
        {
            foreach (var permission in user.Permissions)
            {
                claims.Add(new Claim("Permission", permission));
            }
            _logger.LogInformation(
                "Added {Count} permission claims to token for user {Username}",
                user.Permissions.Count,
                user.Username
            );
        }

        var tokenDescriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(claims),
            Expires = DateTime.UtcNow.AddMinutes(
                int.Parse(_configuration["Jwt:ExpiresInMinutes"] ?? "1440")
            ),
            Issuer = _configuration["Jwt:Issuer"],
            Audience = _configuration["Jwt:Audience"],
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(key),
                SecurityAlgorithms.HmacSha256Signature
            ),
        };

        var token = tokenHandler.CreateToken(tokenDescriptor);
        return tokenHandler.WriteToken(token);
    }

    [HttpPut("users/{userId}")]
    [Authorize]
    public async Task<IActionResult> UpdateUser(int userId, [FromBody] UpdateUserDto updateDto)
    {
        _logger.LogInformation("UpdateUser endpoint called for user ID: {UserId}", userId);
        _logger.LogDebug("Request data: {@UpdateData}", updateDto);

        if (!ModelState.IsValid)
        {
            var errors = ModelState.ToDictionary(
                kvp => kvp.Key,
                kvp => kvp.Value?.Errors.Select(e => e.ErrorMessage).ToArray()
            );
            _logger.LogWarning(
                "Invalid model state: {ModelErrors}",
                string.Join(", ", errors.SelectMany(e => e.Value ?? Array.Empty<string>()))
            );
            return BadRequest(
                new
                {
                    success = false,
                    message = "Validation failed",
                    errors = errors,
                }
            );
        }

        // Get the current user ID from the JWT token
        var currentUserId = GetUserIdFromToken();
        if (
            string.IsNullOrEmpty(currentUserId)
            || !int.TryParse(currentUserId, out int currentUserIdInt)
        )
        {
            _logger.LogWarning("Invalid or missing authentication token");
            return Unauthorized(
                new { success = false, message = "Invalid or missing authentication token" }
            );
        }

        _logger.LogInformation("Current user ID from token: {CurrentUserId}", currentUserIdInt);

        // Only allow users to update their own profile unless they're an admin
        var currentUser = await _userService.GetUserByIdAsync(currentUserIdInt);
        if (currentUser == null)
        {
            _logger.LogWarning("Current user not found with ID: {CurrentUserId}", currentUserIdInt);
            return Unauthorized(new { success = false, message = "User not found" });
        }

        if (currentUser.Id != userId && currentUser.Role != UserRole.Admin)
        {
            _logger.LogWarning(
                "User {CurrentUserId} attempted to update profile for user {UserId} without permission",
                currentUserIdInt,
                userId
            );
            return StatusCode(
                StatusCodes.Status403Forbidden,
                new
                {
                    success = false,
                    message = "You do not have permission to update this profile",
                }
            );
        }

        _logger.LogInformation(
            "Updating user {UserId} with data: {UserData}",
            userId,
            new
            {
                updateDto.FirstName,
                updateDto.LastName,
                updateDto.Email,
            }
        );

        try
        {
            var updatedUser = await _userService.UpdateUserAsync(userId, updateDto);
            if (updatedUser == null)
            {
                _logger.LogWarning(
                    "Failed to update user with ID: {UserId} - User not found",
                    userId
                );
                return NotFound(new { success = false, message = "User not found" });
            }

            _logger.LogInformation("User {UserId} updated successfully", userId);
            return Ok(
                new
                {
                    success = true,
                    message = "User updated successfully",
                    user = new
                    {
                        id = updatedUser.Id,
                        username = updatedUser.Username,
                        email = updatedUser.Email,
                        firstName = updatedUser.FirstName,
                        lastName = updatedUser.LastName,
                        role = updatedUser.Role.ToString(),
                        department = updatedUser.Department,
                        phoneNumber = updatedUser.Phone,
                        permissions = updatedUser.Permissions ?? new List<string>(),
                        isActive = updatedUser.IsActive,
                    },
                }
            );
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(
                "Validation error updating user {UserId}: {ErrorMessage}",
                userId,
                ex.Message
            );
            return BadRequest(new { success = false, message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating user with ID {UserId}", userId);
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                new
                {
                    success = false,
                    message = "An error occurred while updating the user",
                    error = ex.Message,
                    details = ex.InnerException?.Message,
                }
            );
        }
    }

    [HttpDelete("users/{id}")]
    [Authorize]
    public async Task<IActionResult> DeleteUser(int id)
    {
        try
        {
            var result = await _userService.DeleteUserAsync(id);
            if (!result)
            {
                return NotFound(new { success = false, message = "User not found" });
            }

            return Ok(new { success = true, message = "User deleted successfully" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting user with ID {UserId}", id);
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                new { success = false, message = "An error occurred while deleting the user" }
            );
        }
    }

    [HttpGet("users")]
    [Authorize]
    public async Task<IActionResult> GetAllUsers()
    {
        try
        {
            _logger.LogInformation("Fetching all users");
            var users = await _userService.GetAllUsersAsync();

            // Create a simplified response to avoid serialization issues
            var simplifiedUsers = users
                .Select(user => new
                {
                    Id = user.Id.ToString(),
                    user.Username,
                    user.Email,
                    user.FirstName,
                    user.LastName,
                    Role = user.Role.ToString(),
                    user.Department,
                    PermissionCount = user.Permissions?.Count ?? 0,
                    user.IsActive,
                })
                .ToList();

            _logger.LogInformation($"Successfully fetched {simplifiedUsers.Count} users");
            return Ok(new { success = true, users = simplifiedUsers });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching all users");
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                new
                {
                    success = false,
                    message = "An error occurred while fetching users",
                    error = ex.Message,
                }
            );
        }
    }

    private string? GetUserIdFromToken()
    {
        // Use the built-in authentication context instead of manual token parsing
        if (HttpContext.User?.Identity?.IsAuthenticated == true)
        {
            var userIdClaim = HttpContext.User.FindFirst(ClaimTypes.NameIdentifier);
            return userIdClaim?.Value;
        }
        return null;
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
