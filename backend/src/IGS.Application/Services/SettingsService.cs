using System;
using System.Threading.Tasks;
using AutoMapper;
using IGS.Application.DTOs;
using IGS.Application.Services.Interfaces;
using IGS.Domain.Entities;
using IGS.Domain.Repositories;

namespace IGS.Application.Services
{
    public class SettingsService : ISettingsService
    {
        private readonly ISettingsRepository _settingsRepository;
        private readonly IMapper _mapper;

        public SettingsService(ISettingsRepository settingsRepository, IMapper mapper)
        {
            _settingsRepository = settingsRepository;
            _mapper = mapper;
        }

        public async Task<SettingsDto> GetSettingsAsync()
        {
            try
            {
                var settings = await _settingsRepository.GetSettingsAsync();
                return _mapper.Map<SettingsDto>(settings);
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException($"Failed to get settings: {ex.Message}", ex);
            }
        }

        public async Task<SettingsDto> UpdateSettingsAsync(UpdateSettingsDto updateSettingsDto)
        {
            try
            {
                var currentSettings = await _settingsRepository.GetSettingsAsync();
                _mapper.Map(updateSettingsDto, currentSettings);

                var updatedSettings = await _settingsRepository.UpdateSettingsAsync(
                    currentSettings
                );
                return _mapper.Map<SettingsDto>(updatedSettings);
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException($"Failed to update settings: {ex.Message}", ex);
            }
        }
    }
}
