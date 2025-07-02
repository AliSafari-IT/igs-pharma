namespace IGS.Domain.Entities;

public class SaleItem
{
    public int Id { get; set; }
    
    public int Quantity { get; set; }
    
    public decimal UnitPrice { get; set; }
    
    public decimal DiscountAmount { get; set; }
    
    public decimal TotalPrice { get; set; }
    
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    // Navigation properties
    public int SaleId { get; set; }
    public Sale Sale { get; set; } = null!;
    
    public int ProductId { get; set; }
    public Product Product { get; set; } = null!;
}
