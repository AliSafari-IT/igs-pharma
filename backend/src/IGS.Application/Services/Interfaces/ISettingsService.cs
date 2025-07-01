using System.Threading.Tasks;
using IGS.Application.DTOs;

namespace IGS.Application.Services.Interfaces
{
    public interface ISettingsService
    {
        Task<SettingsDto> GetSettingsAsync();
        Task<SettingsDto> UpdateSettingsAsync(UpdateSettingsDto updateSettingsDto);
    }
}
