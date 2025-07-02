using AutoMapper;
using IGS.Application.DTOs;
using IGS.Domain.Entities;

namespace IGS.Application.Mappings
{
    public class PatientMappingProfile : Profile
    {
        public PatientMappingProfile()
        {
            // Map from Patient entity to PatientDto
            CreateMap<Patient, PatientDto>()
                .ForMember(
                    dest => dest.FullName,
                    opt => opt.MapFrom(src => $"{src.FirstName} {src.LastName}")
                )
                .ForMember(dest => dest.Age, opt => opt.MapFrom(src => src.Age));

            // Map from CreatePatientDto to Patient entity
            CreateMap<CreatePatientDto, Patient>();

            // Map from UpdatePatientDto to Patient entity
            CreateMap<UpdatePatientDto, Patient>();
        }
    }
}
