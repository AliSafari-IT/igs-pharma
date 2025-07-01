using AutoMapper;
using IGS.Application.DTOs;
using IGS.Domain.Entities;

namespace IGS.WebAPI.Mappings
{
    public class SupplierMappingProfile : Profile
    {
        public SupplierMappingProfile()
        {
            // Explicitly define Supplier mappings in WebAPI project
            CreateMap<Supplier, SupplierDto>();
            CreateMap<CreateSupplierDto, Supplier>();
            CreateMap<UpdateSupplierDto, Supplier>();
        }
    }
}
