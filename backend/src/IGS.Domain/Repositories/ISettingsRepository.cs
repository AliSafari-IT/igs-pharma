using System.Threading.Tasks;
using IGS.Domain.Entities;

namespace IGS.Domain.Repositories
{
    public interface ISettingsRepository
    {
        Task<Settings> GetSettingsAsync();
        Task<Settings> UpdateSettingsAsync(Settings settings);
    }
}
