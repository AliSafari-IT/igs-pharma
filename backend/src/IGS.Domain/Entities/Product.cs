using System.ComponentModel.DataAnnotations;

namespace IGS.Domain.Entities;

public class Product
{
    public int Id { get; set; }
    
    [Required]
    [MaxLength(200)]
    public string Name { get; set; } = string.Empty;
    
    [MaxLength(500)]
    public string Description { get; set; } = string.Empty;
    
    [Required]
    [MaxLength(50)]
    public string SKU { get; set; } = string.Empty;
    
    [MaxLength(100)]
    public string Barcode { get; set; } = string.Empty;
    
    public decimal Price { get; set; }
    
    public decimal CostPrice { get; set; }
    
    public int StockQuantity { get; set; }
    
    public int MinStockLevel { get; set; }
    
    public int MaxStockLevel { get; set; }
    
    public DateTime? ExpiryDate { get; set; }
    
    public DateTime? ManufactureDate { get; set; }
    
    [MaxLength(100)]
    public string Manufacturer { get; set; } = string.Empty;
    
    [MaxLength(100)]
    public string BatchNumber { get; set; } = string.Empty;
    
    public bool RequiresPrescription { get; set; }
    
    public bool IsActive { get; set; } = true;
    
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    
    // Navigation properties
    public int CategoryId { get; set; }
    public Category Category { get; set; } = null!;
    
    public int? SupplierId { get; set; }
    public Supplier? Supplier { get; set; }
    
    public ICollection<SaleItem> SaleItems { get; set; } = new List<SaleItem>();
    public ICollection<PrescriptionItem> PrescriptionItems { get; set; } = new List<PrescriptionItem>();
    public ICollection<InventoryTransaction> InventoryTransactions { get; set; } = new List<InventoryTransaction>();
}
