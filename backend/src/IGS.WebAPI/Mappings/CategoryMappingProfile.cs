using AutoMapper;
using IGS.Application.DTOs;
using IGS.Domain.Entities;

namespace IGS.WebAPI.Mappings
{
    public class CategoryMappingProfile : Profile
    {
        public CategoryMappingProfile()
        {
            // Explicitly define Category mappings in WebAPI project
            CreateMap<Category, CategoryDto>();
            CreateMap<CreateCategoryDto, Category>();
            CreateMap<UpdateCategoryDto, Category>();
        }
    }
}
