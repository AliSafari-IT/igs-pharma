using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using AutoMapper;
using IGS.Application.DTOs;
using IGS.Application.Interfaces;
using IGS.Domain.Entities;
using IGS.Domain.Interfaces;

namespace IGS.Application.Services
{
    public class SupplierService : ISupplierService
    {
        private readonly ISupplierRepository _supplierRepository;
        private readonly IMapper _mapper;

        public SupplierService(ISupplierRepository supplierRepository, IMapper mapper)
        {
            _supplierRepository = supplierRepository;
            _mapper = mapper;
        }

        public async Task<IEnumerable<SupplierDto>> GetAllAsync()
        {
            var suppliers = await _supplierRepository.GetAllAsync();
            return _mapper.Map<IEnumerable<SupplierDto>>(suppliers);
        }

        public async Task<SupplierDto?> GetByIdAsync(int id)
        {
            var supplier = await _supplierRepository.GetByIdAsync(id);
            return supplier == null ? null : _mapper.Map<SupplierDto>(supplier);
        }

        public async Task<SupplierDto> CreateAsync(CreateSupplierDto createDto)
        {
            var supplier = _mapper.Map<Supplier>(createDto);
            await _supplierRepository.AddAsync(supplier);
            return _mapper.Map<SupplierDto>(supplier);
        }

        public async Task<SupplierDto?> UpdateAsync(int id, UpdateSupplierDto updateDto)
        {
            var supplier = await _supplierRepository.GetByIdAsync(id);
            if (supplier == null)
                return null;

            _mapper.Map(updateDto, supplier);
            await _supplierRepository.UpdateAsync(supplier);
            return _mapper.Map<SupplierDto>(supplier);
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var supplier = await _supplierRepository.GetByIdAsync(id);
            if (supplier == null)
                return false;

            _supplierRepository.Remove(supplier);
            return true;
        }
    }
}
