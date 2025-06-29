using System.ComponentModel.DataAnnotations;

namespace IGS.Domain.Entities;

public class Sale
{
    public int Id { get; set; }
    
    [Required]
    [MaxLength(50)]
    public string SaleNumber { get; set; } = string.Empty;
    
    public DateTime SaleDate { get; set; } = DateTime.UtcNow;
    
    public decimal SubTotal { get; set; }
    
    public decimal TaxAmount { get; set; }
    
    public decimal DiscountAmount { get; set; }
    
    public decimal TotalAmount { get; set; }
    
    public PaymentMethod PaymentMethod { get; set; }
    
    [MaxLength(100)]
    public string PaymentReference { get; set; } = string.Empty;
    
    public SaleStatus Status { get; set; } = SaleStatus.Completed;
    
    [MaxLength(500)]
    public string Notes { get; set; } = string.Empty;
    
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    
    // Navigation properties
    public int? PatientId { get; set; }
    public Patient? Patient { get; set; }
    
    public int UserId { get; set; }
    public User User { get; set; } = null!;
    
    public ICollection<SaleItem> SaleItems { get; set; } = new List<SaleItem>();
}

public enum PaymentMethod
{
    Cash,
    CreditCard,
    DebitCard,
    Insurance,
    Check,
    DigitalWallet
}

public enum SaleStatus
{
    Pending,
    Completed,
    Cancelled,
    Refunded,
    PartiallyRefunded
}
