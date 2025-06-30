using System.ComponentModel.DataAnnotations;

namespace IGS.Domain.Entities;

public class User
{
    public int Id { get; set; }

    [Required]
    [MaxLength(100)]
    public string FirstName { get; set; } = string.Empty;

    [Required]
    [MaxLength(100)]
    public string LastName { get; set; } = string.Empty;

    [Required]
    [EmailAddress]
    [MaxLength(200)]
    public string Email { get; set; } = string.Empty;

    [Required]
    [MaxLength(50)]
    public string Username { get; set; } = string.Empty;

    [Required]
    public string PasswordHash { get; set; } = string.Empty;

    [MaxLength(20)]
    public string Phone { get; set; } = string.Empty;

    [MaxLength(100)]
    public string Department { get; set; } = string.Empty;

    public UserRole Role { get; set; } = UserRole.Pharmacist;

    [MaxLength(50)]
    public string EmployeeId { get; set; } = string.Empty;

    [MaxLength(50)]
    public string CardId { get; set; } = string.Empty;

    public DateTime? CardExpiryDate { get; set; }

    [MaxLength(100)]
    public string LicenseNumber { get; set; } = string.Empty;

    public List<string> Permissions { get; set; } = new List<string>();

    public bool IsActive { get; set; } = true;

    public DateTime LastLoginAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public ICollection<Sale> Sales { get; set; } = new List<Sale>();

    // Computed property
    public string FullName => $"{FirstName} {LastName}";
}

public enum UserRole
{
    Admin,
    Manager,
    Pharmacist,
    Technician,
    Cashier,
}
