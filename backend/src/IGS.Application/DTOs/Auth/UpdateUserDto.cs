using System.ComponentModel.DataAnnotations;

namespace IGS.Application.DTOs.Auth;

public class UpdateUserDto
{
    [StringLength(50, ErrorMessage = "First name cannot be longer than 50 characters.")]
    public string? FirstName { get; set; }

    [StringLength(50, ErrorMessage = "Last name cannot be longer than 50 characters.")]
    public string? LastName { get; set; }

    [EmailAddress(ErrorMessage = "Invalid email address.")]
    public string? Email { get; set; }

    [Phone(ErrorMessage = "Invalid phone number.")]
    public string? PhoneNumber { get; set; }

    [StringLength(100, ErrorMessage = "Department cannot be longer than 100 characters.")]
    public string? Department { get; set; }

    // Note: Password updates should be handled separately with proper security measures
}
