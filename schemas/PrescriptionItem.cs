using System.ComponentModel.DataAnnotations;

namespace IGS.Domain.Entities;

public class PrescriptionItem
{
    public int Id { get; set; }
    
    public int Quantity { get; set; }
    
    [MaxLength(500)]
    public string Dosage { get; set; } = string.Empty;
    
    [MaxLength(500)]
    public string Instructions { get; set; } = string.Empty;
    
    public int DaysSupply { get; set; }
    
    public bool IsGenericAllowed { get; set; } = true;
    
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    // Navigation properties
    public int PrescriptionId { get; set; }
    public Prescription Prescription { get; set; } = null!;
    
    public int ProductId { get; set; }
    public Product Product { get; set; } = null!;
}
