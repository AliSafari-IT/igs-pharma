using System.ComponentModel.DataAnnotations;

namespace IGS.Domain.Entities;

public class InventoryTransaction
{
    public int Id { get; set; }
    
    public InventoryTransactionType Type { get; set; }
    
    public int Quantity { get; set; }
    
    public int PreviousStock { get; set; }
    
    public int NewStock { get; set; }
    
    [MaxLength(500)]
    public string Reason { get; set; } = string.Empty;
    
    [MaxLength(100)]
    public string Reference { get; set; } = string.Empty;
    
    public DateTime TransactionDate { get; set; } = DateTime.UtcNow;
    
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    // Navigation properties
    public int ProductId { get; set; }
    public Product Product { get; set; } = null!;
    
    public int UserId { get; set; }
    public User User { get; set; } = null!;
}

public enum InventoryTransactionType
{
    StockIn,
    StockOut,
    Adjustment,
    Transfer,
    Damaged,
    Expired,
    Return
}
