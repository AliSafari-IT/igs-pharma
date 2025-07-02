using AutoMapper;
using BCrypt.Net;
using IGS.Application.DTOs.Auth;
using IGS.Application.Interfaces;
using IGS.Domain.Entities;
using IGS.Domain.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace IGS.Application.Services;

public class UserService : IUserService
{
    private readonly IUserRepository _userRepository;
    private readonly IMapper _mapper;
    private readonly ILogger<UserService> _logger;

    public UserService(IUserRepository userRepository, IMapper mapper, ILogger<UserService> logger)
    {
        _userRepository = userRepository;
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

            await _userRepository.AddAsync(user);

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
        var user = await _userRepository.GetByUsernameAsync(username);

        if (
            user == null
            || !user.IsActive
            || !BCrypt.Net.BCrypt.Verify(password, user.PasswordHash)
        )
            return null;

        return user;
    }

    public async Task<User?> GetUserByIdAsync(int userId)
    {
        var user = await _userRepository.GetByIdAsync(userId);
        return user?.IsActive == true ? user : null;
    }

    public async Task<User?> GetUserByUsernameAsync(string username)
    {
        var user = await _userRepository.GetByUsernameAsync(username);
        return user?.IsActive == true ? user : null;
    }

    public async Task<User?> GetUserByEmailAsync(string email)
    {
        var user = await _userRepository.GetByEmailAsync(email.ToLowerInvariant());
        return user?.IsActive == true ? user : null;
    }

    public async Task<User?> GetUserByCardIdAsync(string cardId)
    {
        var users = await _userRepository.FindAsync(u => u.CardId == cardId);
        return users.FirstOrDefault(u => u.IsActive);
    }

    public async Task<User?> GetUserByEmployeeIdAsync(string employeeId)
    {
        var users = await _userRepository.FindAsync(u => u.EmployeeId == employeeId);
        return users.FirstOrDefault(u => u.IsActive);
    }

    public async Task<bool> IsUsernameAvailableAsync(string username)
    {
        return !await _userRepository.UsernameExistsAsync(username);
    }

    public async Task<bool> IsEmailAvailableAsync(string email)
    {
        return !await _userRepository.EmailExistsAsync(email.ToLowerInvariant());
    }

    public async Task<bool> IsEmployeeIdAvailableAsync(string employeeId)
    {
        if (string.IsNullOrEmpty(employeeId))
            return true;
        var users = await _userRepository.FindAsync(u => u.EmployeeId == employeeId);
        return !users.Any();
    }

    public async Task<bool> IsCardIdAvailableAsync(string cardId)
    {
        if (string.IsNullOrEmpty(cardId))
            return true;
        var users = await _userRepository.FindAsync(u => u.CardId == cardId);
        return !users.Any();
    }

    public async Task<User?> UpdateUserAsync(int userId, UpdateUserDto updateDto)
    {
        try
        {
            var user = await _userRepository.GetByIdAsync(userId);
            if (user == null)
                return null;

            // Update basic properties
            user.FirstName = updateDto.FirstName ?? user.FirstName;
            user.LastName = updateDto.LastName ?? user.LastName;
            user.Email = updateDto.Email ?? user.Email;
            user.Phone = updateDto.PhoneNumber ?? user.Phone;
            user.Department = updateDto.Department ?? user.Department;

            // Note: Password updates are handled separately for security reasons

            await _userRepository.UpdateAsync(user);
            _logger.LogInformation("User {UserId} profile updated successfully", userId);

            return user;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating user with ID {UserId}", userId);
            throw new Exception($"An error occurred while updating the user: {ex.Message}", ex);
        }
    }

    private List<string> GetDefaultPermissions(string role)
    {
        return role.ToLower() switch
        {
            "admin" => new List<string>
            {
                "products.read",
                "products.write",
                "inventory.read",
                "inventory.write",
                "categories.read",
                "categories.write",
                "suppliers.read",
                "suppliers.write",
                "sales.read",
                "sales.write",
                "patients.read",
                "patients.write",
                "prescriptions.read",
                "prescriptions.write",
                "reports.read",
                "settings.read",
                "settings.write",
                "users.read",
                "users.write",
            },
            "pharmacist" => new List<string>
            {
                "products.read",
                "products.write",
                "inventory.read",
                "inventory.write",
                "categories.read",
                "suppliers.read",
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

    public async Task<bool> DeleteUserAsync(int userId)
    {
        try
        {
            var user = await _userRepository.GetByIdAsync(userId);
            if (user == null)
            {
                _logger.LogWarning("User with ID {UserId} not found for deletion", userId);
                return false;
            }

            // Perform the deletion
            _userRepository.Remove(user);
            await _userRepository.SaveChangesAsync();
            _logger.LogInformation("User with ID {UserId} deleted successfully", userId);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting user with ID {UserId}", userId);
            throw;
        }
    }

    public async Task<IEnumerable<User>> GetAllUsersAsync()
    {
        try
        {
            _logger.LogInformation("Getting all users from repository");
            var users = await _userRepository.GetAllAsync();
            _logger.LogInformation("Retrieved {Count} users from repository", users.Count());
            return users;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving all users");
            throw;
        }
    }
}
