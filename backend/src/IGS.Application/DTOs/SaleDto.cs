using IGS.Domain.Entities;

namespace IGS.Application.DTOs;

public class SaleDto
{
    public int Id { get; set; }
    public string SaleNumber { get; set; } = string.Empty;
    public DateTime SaleDate { get; set; }
    public decimal SubTotal { get; set; }
    public decimal TaxAmount { get; set; }
    public decimal DiscountAmount { get; set; }
    public decimal TotalAmount { get; set; }
    public PaymentMethod PaymentMethod { get; set; }
    public string PaymentReference { get; set; } = string.Empty;
    public SaleStatus Status { get; set; }
    public string Notes { get; set; } = string.Empty;
    public int? PatientId { get; set; }
    public string PatientName { get; set; } = string.Empty;
    public int UserId { get; set; }
    public string UserName { get; set; } = string.Empty;
    public List<SaleItemDto> SaleItems { get; set; } = new();
    public DateTime CreatedAt { get; set; }
}

public class SaleItemDto
{
    public int Id { get; set; }
    public int ProductId { get; set; }
    public string ProductName { get; set; } = string.Empty;
    public string ProductSKU { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal DiscountAmount { get; set; }
    public decimal TotalPrice { get; set; }
}

public class CreateSaleDto
{
    public int? PatientId { get; set; }
    public PaymentMethod PaymentMethod { get; set; }
    public string PaymentReference { get; set; } = string.Empty;
    public decimal DiscountAmount { get; set; }
    public string Notes { get; set; } = string.Empty;
    public List<CreateSaleItemDto> SaleItems { get; set; } = new();
}

public class CreateSaleItemDto
{
    public int ProductId { get; set; }
    public int Quantity { get; set; }
    public decimal DiscountAmount { get; set; }
}
