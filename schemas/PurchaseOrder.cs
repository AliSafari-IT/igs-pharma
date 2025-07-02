using System.ComponentModel.DataAnnotations;

namespace IGS.Domain.Entities;

public class PurchaseOrder
{
    public int Id { get; set; }
    
    [Required]
    [MaxLength(50)]
    public string OrderNumber { get; set; } = string.Empty;
    
    public DateTime OrderDate { get; set; } = DateTime.UtcNow;
    
    public DateTime? ExpectedDeliveryDate { get; set; }
    
    public DateTime? ActualDeliveryDate { get; set; }
    
    public decimal SubTotal { get; set; }
    
    public decimal TaxAmount { get; set; }
    
    public decimal TotalAmount { get; set; }
    
    public PurchaseOrderStatus Status { get; set; } = PurchaseOrderStatus.Pending;
    
    [MaxLength(500)]
    public string Notes { get; set; } = string.Empty;
    
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    
    // Navigation properties
    public int SupplierId { get; set; }
    public Supplier Supplier { get; set; } = null!;
    
    public int UserId { get; set; }
    public User User { get; set; } = null!;
    
    public ICollection<PurchaseOrderItem> PurchaseOrderItems { get; set; } = new List<PurchaseOrderItem>();
}

public class PurchaseOrderItem
{
    public int Id { get; set; }
    
    public int Quantity { get; set; }
    
    public decimal UnitPrice { get; set; }
    
    public decimal TotalPrice { get; set; }
    
    public int ReceivedQuantity { get; set; }
    
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    // Navigation properties
    public int PurchaseOrderId { get; set; }
    public PurchaseOrder PurchaseOrder { get; set; } = null!;
    
    public int ProductId { get; set; }
    public Product Product { get; set; } = null!;
}

public enum PurchaseOrderStatus
{
    Pending,
    Approved,
    Ordered,
    PartiallyReceived,
    Received,
    Cancelled
}
