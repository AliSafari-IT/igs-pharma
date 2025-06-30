using AutoMapper;
using BCrypt.Net;
using IGS.Application.DTOs.Auth;
using IGS.Application.Interfaces;
using IGS.Domain.Entities;
using IGS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace IGS.Application.Services;

public class UserService : IUserService
{
    private readonly PharmacyDbContext _context;
    private readonly IMapper _mapper;
    private readonly ILogger<UserService> _logger;

    public UserService(PharmacyDbContext context, IMapper mapper, ILogger<UserService> logger)
    {
        _context = context;
        _mapper = mapper;
        _logger = logger;
    }

    public async Task<RegisterUserResponseDto> RegisterUserAsync(RegisterUserDto registerDto)
    {
        try
        {
            // Validate unique constraints
            if (!await IsUsernameAvailableAsync(registerDto.Username))
                throw new InvalidOperationException("Username is already taken");

            if (!await IsEmailAvailableAsync(registerDto.Email))
                throw new InvalidOperationException("Email is already registered");

            if (
                !string.IsNullOrEmpty(registerDto.EmployeeId)
                && !await IsEmployeeIdAvailableAsync(registerDto.EmployeeId)
            )
                throw new InvalidOperationException("Employee ID is already assigned");

            if (
                !string.IsNullOrEmpty(registerDto.CardId)
                && !await IsCardIdAvailableAsync(registerDto.CardId)
            )
                throw new InvalidOperationException("Card ID is already assigned");

            // Create new user entity
            var user = new User
            {
                FirstName = registerDto.FirstName,
                LastName = registerDto.LastName,
                Email = registerDto.Email,
                Username = registerDto.Username,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(registerDto.Password),
                Phone = registerDto.PhoneNumber,
                Department = registerDto.Department,
                Role = Enum.Parse<UserRole>(registerDto.Role, true),
                EmployeeId = registerDto.EmployeeId,
                CardId = string.IsNullOrEmpty(registerDto.CardId)
                    ? $"CARD_{Guid.NewGuid().ToString("N")[..8].ToUpper()}"
                    : registerDto.CardId,
                CardExpiryDate = registerDto.CardExpiryDate,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
                Permissions = GetDefaultPermissions(registerDto.Role),
            };

            _context.Users.Add(user);
            await _context.SaveChangesAsync();

            _logger.LogInformation(
                "User {Username} registered successfully with ID {UserId}",
                user.Username,
                user.Id
            );

            return new RegisterUserResponseDto
            {
                Id = user.Id.ToString(),
                Username = user.Username,
                Email = user.Email,
                FirstName = user.FirstName,
                LastName = user.LastName,
                Role = user.Role.ToString(),
                Department = user.Department,
                IsActive = user.IsActive,
                CreatedAt = user.CreatedAt,
                Message = "User registered successfully",
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error registering user {Username}", registerDto.Username);
            throw;
        }
    }

    public async Task<User?> ValidateCredentialsAsync(string username, string password)
    {
        var user = await _context.Users.FirstOrDefaultAsync(u =>
            u.Username == username && u.IsActive
        );

        if (user == null || !BCrypt.Net.BCrypt.Verify(password, user.PasswordHash))
            return null;

        return user;
    }

    public async Task<User?> GetUserByIdAsync(int userId)
    {
        return await _context.Users.FirstOrDefaultAsync(u => u.Id == userId && u.IsActive);
    }

    public async Task<User?> GetUserByUsernameAsync(string username)
    {
        return await _context.Users.FirstOrDefaultAsync(u => u.Username == username && u.IsActive);
    }

    public async Task<User?> GetUserByEmailAsync(string email)
    {
        return await _context.Users.FirstOrDefaultAsync(u =>
            u.Email == email.ToLowerInvariant() && u.IsActive
        );
    }

    public async Task<User?> GetUserByCardIdAsync(string cardId)
    {
        return await _context.Users.FirstOrDefaultAsync(u => u.CardId == cardId && u.IsActive);
    }

    public async Task<User?> GetUserByEmployeeIdAsync(string employeeId)
    {
        return await _context.Users.FirstOrDefaultAsync(u =>
            u.EmployeeId == employeeId && u.IsActive
        );
    }

    public async Task<bool> IsUsernameAvailableAsync(string username)
    {
        return !await _context.Users.AnyAsync(u => u.Username == username);
    }

    public async Task<bool> IsEmailAvailableAsync(string email)
    {
        return !await _context.Users.AnyAsync(u => u.Email == email.ToLowerInvariant());
    }

    public async Task<bool> IsEmployeeIdAvailableAsync(string employeeId)
    {
        if (string.IsNullOrEmpty(employeeId))
            return true;
        return !await _context.Users.AnyAsync(u => u.EmployeeId == employeeId);
    }

    public async Task<bool> IsCardIdAvailableAsync(string cardId)
    {
        if (string.IsNullOrEmpty(cardId))
            return true;
        return !await _context.Users.AnyAsync(u => u.CardId == cardId);
    }

    public async Task<User?> UpdateUserAsync(int userId, UpdateUserDto updateDto)
    {
        try
        {
            _logger.LogInformation("Starting update for user ID: {UserId}", userId);
            _logger.LogDebug("Update data: {@UpdateData}", updateDto);

            var user = await _context.Users.FindAsync(userId);
            if (user == null)
            {
                _logger.LogWarning("User with ID {UserId} not found for update", userId);
                return null;
            }

            try
            {
                // Update fields if they are provided in the DTO
                if (!string.IsNullOrEmpty(updateDto.FirstName))
                {
                    _logger.LogDebug(
                        "Updating FirstName from '{Old}' to '{New}'",
                        user.FirstName,
                        updateDto.FirstName
                    );
                    user.FirstName = updateDto.FirstName;
                }

                if (!string.IsNullOrEmpty(updateDto.LastName))
                {
                    _logger.LogDebug(
                        "Updating LastName from '{Old}' to '{New}'",
                        user.LastName,
                        updateDto.LastName
                    );
                    user.LastName = updateDto.LastName;
                }

                if (!string.IsNullOrEmpty(updateDto.Email) && updateDto.Email != user.Email)
                {
                    _logger.LogDebug(
                        "Updating Email from '{Old}' to '{New}'",
                        user.Email,
                        updateDto.Email
                    );
                    if (!await IsEmailAvailableAsync(updateDto.Email))
                    {
                        var errorMsg =
                            $"Email '{updateDto.Email}' is already in use by another user";
                        _logger.LogWarning(errorMsg);
                        throw new InvalidOperationException(errorMsg);
                    }
                    user.Email = updateDto.Email;
                }

                if (!string.IsNullOrEmpty(updateDto.PhoneNumber))
                {
                    _logger.LogDebug(
                        "Updating Phone from '{Old}' to '{New}'",
                        user.Phone,
                        updateDto.PhoneNumber
                    );
                    user.Phone = updateDto.PhoneNumber;
                }

                if (updateDto.Department != null)
                {
                    _logger.LogDebug(
                        "Updating Department from '{Old}' to '{New}'",
                        user.Department,
                        updateDto.Department
                    );
                    user.Department = updateDto.Department;
                }

                user.UpdatedAt = DateTime.UtcNow;

                await _context.SaveChangesAsync();
                _logger.LogInformation("User {UserId} profile updated successfully", userId);

                return user;
            }
            catch (Exception ex) when (ex is not InvalidOperationException)
            {
                _logger.LogError(ex, "Error updating user with ID {UserId}", userId);
                throw new Exception($"An error occurred while updating the user: {ex.Message}", ex);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Unexpected error in UpdateUserAsync for user ID {UserId}",
                userId
            );
            throw new Exception($"An unexpected error occurred: {ex.Message}", ex);
        }
    }

    private static List<string> GetDefaultPermissions(string role)
    {
        return role.ToLowerInvariant() switch
        {
            "admin" => new List<string>
            {
                "users.read",
                "users.write",
                "users.delete",
                "products.read",
                "products.write",
                "products.delete",
                "inventory.read",
                "inventory.write",
                "sales.read",
                "sales.write",
                "patients.read",
                "patients.write",
                "prescriptions.read",
                "prescriptions.write",
                "reports.read",
                "settings.read",
                "settings.write",
            },
            "pharmacist" => new List<string>
            {
                "products.read",
                "products.write",
                "inventory.read",
                "inventory.write",
                "sales.read",
                "sales.write",
                "patients.read",
                "patients.write",
                "prescriptions.read",
                "prescriptions.write",
                "reports.read",
            },
            "technician" => new List<string>
            {
                "products.read",
                "inventory.read",
                "inventory.write",
                "sales.read",
                "sales.write",
                "patients.read",
                "prescriptions.read",
            },
            "cashier" => new List<string>
            {
                "products.read",
                "sales.read",
                "sales.write",
                "patients.read",
            },
            _ => new List<string> { "products.read" }, // Default employee permissions
        };
    }
}
