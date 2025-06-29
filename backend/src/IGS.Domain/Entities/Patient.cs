using System.ComponentModel.DataAnnotations;

namespace IGS.Domain.Entities;

public class Patient
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
    
    [MaxLength(20)]
    public string Phone { get; set; } = string.Empty;
    
    public DateTime DateOfBirth { get; set; }
    
    [MaxLength(10)]
    public string Gender { get; set; } = string.Empty;
    
    [MaxLength(500)]
    public string Address { get; set; } = string.Empty;
    
    [MaxLength(100)]
    public string City { get; set; } = string.Empty;
    
    [MaxLength(20)]
    public string PostalCode { get; set; } = string.Empty;
    
    [MaxLength(100)]
    public string Country { get; set; } = string.Empty;
    
    [MaxLength(50)]
    public string InsuranceNumber { get; set; } = string.Empty;
    
    [MaxLength(100)]
    public string InsuranceProvider { get; set; } = string.Empty;
    
    [MaxLength(1000)]
    public string Allergies { get; set; } = string.Empty;
    
    [MaxLength(1000)]
    public string MedicalConditions { get; set; } = string.Empty;
    
    public bool IsActive { get; set; } = true;
    
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    
    // Navigation properties
    public ICollection<Prescription> Prescriptions { get; set; } = new List<Prescription>();
    public ICollection<Sale> Sales { get; set; } = new List<Sale>();
    
    // Computed property
    public string FullName => $"{FirstName} {LastName}";
    public int Age => DateTime.Now.Year - DateOfBirth.Year - (DateTime.Now.DayOfYear < DateOfBirth.DayOfYear ? 1 : 0);
}
