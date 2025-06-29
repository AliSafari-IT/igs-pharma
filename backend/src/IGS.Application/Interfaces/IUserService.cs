using IGS.Application.DTOs.Auth;
using IGS.Domain.Entities;

namespace IGS.Application.Interfaces;

public interface IUserService
{
    Task<RegisterUserResponseDto> RegisterUserAsync(RegisterUserDto registerDto);
    Task<User?> ValidateCredentialsAsync(string username, string password);
    Task<User?> GetUserByIdAsync(int userId);
    Task<User?> GetUserByUsernameAsync(string username);
    Task<User?> GetUserByEmailAsync(string email);
    Task<User?> GetUserByCardIdAsync(string cardId);
    Task<User?> GetUserByEmployeeIdAsync(string employeeId);
    Task<bool> IsUsernameAvailableAsync(string username);
    Task<bool> IsEmailAvailableAsync(string email);
    Task<bool> IsEmployeeIdAvailableAsync(string employeeId);
    Task<bool> IsCardIdAvailableAsync(string cardId);
}
