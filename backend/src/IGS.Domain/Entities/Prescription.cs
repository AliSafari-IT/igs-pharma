using System.ComponentModel.DataAnnotations;

namespace IGS.Domain.Entities;

public class Prescription
{
    public int Id { get; set; }
    
    [Required]
    [MaxLength(50)]
    public string PrescriptionNumber { get; set; } = string.Empty;
    
    public DateTime PrescriptionDate { get; set; }
    
    [Required]
    [MaxLength(200)]
    public string DoctorName { get; set; } = string.Empty;
    
    [MaxLength(100)]
    public string DoctorLicense { get; set; } = string.Empty;
    
    [MaxLength(200)]
    public string DoctorPhone { get; set; } = string.Empty;
    
    [MaxLength(500)]
    public string Instructions { get; set; } = string.Empty;
    
    public PrescriptionStatus Status { get; set; } = PrescriptionStatus.Pending;
    
    public DateTime? FilledDate { get; set; }
    
    public int RefillsRemaining { get; set; }
    
    public int TotalRefills { get; set; }
    
    public bool IsActive { get; set; } = true;
    
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    
    // Navigation properties
    public int PatientId { get; set; }
    public Patient Patient { get; set; } = null!;
    
    public ICollection<PrescriptionItem> PrescriptionItems { get; set; } = new List<PrescriptionItem>();
}

public enum PrescriptionStatus
{
    Pending,
    Filled,
    PartiallyFilled,
    Cancelled,
    Expired
}
