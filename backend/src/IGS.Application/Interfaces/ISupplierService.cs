using System.Collections.Generic;
using System.Threading.Tasks;
using IGS.Application.DTOs;

namespace IGS.Application.Interfaces
{
    public interface ISupplierService
    {
        Task<IEnumerable<SupplierDto>> GetAllAsync();
        Task<SupplierDto?> GetByIdAsync(int id);
        Task<SupplierDto> CreateAsync(CreateSupplierDto createDto);
        Task<SupplierDto?> UpdateAsync(int id, UpdateSupplierDto updateDto);
        Task<bool> DeleteAsync(int id);
    }
}
