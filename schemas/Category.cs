using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace IGS.Domain.Entities;

public class Category
{
    public int Id { get; set; }

    [Required]
    [MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(500)]
    public string Description { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    [JsonIgnore] // Prevent circular references during serialization
    public ICollection<Product> Products { get; set; } = new List<Product>();
}
