using AutoMapper;
using IGS.Application.DTOs;
using IGS.Domain.Entities;

namespace IGS.WebAPI.Mappings
{
    public class SettingsMappingProfile : Profile
    {
        public SettingsMappingProfile()
        {
            CreateMap<Settings, SettingsDto>();
            CreateMap<UpdateSettingsDto, Settings>();
        }
    }
}
