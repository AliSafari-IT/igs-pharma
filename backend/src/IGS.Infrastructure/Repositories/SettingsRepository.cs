using System;
using System.Linq;
using System.Threading.Tasks;
using IGS.Domain.Entities;
using IGS.Domain.Repositories;
using IGS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace IGS.Infrastructure.Repositories
{
    public class SettingsRepository : ISettingsRepository
    {
        private readonly PharmacyDbContext _context;

        public SettingsRepository(PharmacyDbContext context)
        {
            _context = context;
        }

        public async Task<Settings> GetSettingsAsync()
        {
            // We only have one settings record, so get the first one or create a new one if none exists
            var settings = await _context.Settings.FirstOrDefaultAsync();

            if (settings == null)
            {
                // Create default settings
                settings = new Settings
                {
                    PharmacyName = "IGS Pharmacy",
                    Address = "123 Main Street, City, State 12345",
                    Phone = "(555) 123-4567",
                    Email = "info@igspharmacy.com",
                    LowStockAlerts = true,
                    ExpiryAlerts = true,
                    PrescriptionReminders = true,
                    EmailNotifications = true,
                    SmsNotifications = false,
                    AutoReorder = true,
                    ReorderThreshold = 10,
                    DefaultSupplier = "MedSupply Co.",
                    SessionTimeout = 30,
                    RequirePasswordChange = true,
                    TwoFactorAuth = false,
                    AutoBackup = true,
                    BackupFrequency = "daily",
                    RetentionDays = 30,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow,
                };

                _context.Settings.Add(settings);
                await _context.SaveChangesAsync();
            }

            return settings;
        }

        public async Task<Settings> UpdateSettingsAsync(Settings settings)
        {
            var existingSettings = await _context.Settings.FirstOrDefaultAsync();

            if (existingSettings == null)
            {
                // If no settings exist, create new ones
                settings.CreatedAt = DateTime.UtcNow;
                settings.UpdatedAt = DateTime.UtcNow;
                _context.Settings.Add(settings);
            }
            else
            {
                // Update existing settings
                existingSettings.PharmacyName = settings.PharmacyName;
                existingSettings.Address = settings.Address;
                existingSettings.Phone = settings.Phone;
                existingSettings.Email = settings.Email;
                existingSettings.LowStockAlerts = settings.LowStockAlerts;
                existingSettings.ExpiryAlerts = settings.ExpiryAlerts;
                existingSettings.PrescriptionReminders = settings.PrescriptionReminders;
                existingSettings.EmailNotifications = settings.EmailNotifications;
                existingSettings.SmsNotifications = settings.SmsNotifications;
                existingSettings.AutoReorder = settings.AutoReorder;
                existingSettings.ReorderThreshold = settings.ReorderThreshold;
                existingSettings.DefaultSupplier = settings.DefaultSupplier;
                existingSettings.SessionTimeout = settings.SessionTimeout;
                existingSettings.RequirePasswordChange = settings.RequirePasswordChange;
                existingSettings.TwoFactorAuth = settings.TwoFactorAuth;
                existingSettings.AutoBackup = settings.AutoBackup;
                existingSettings.BackupFrequency = settings.BackupFrequency;
                existingSettings.RetentionDays = settings.RetentionDays;
                existingSettings.UpdatedAt = DateTime.UtcNow;

                _context.Settings.Update(existingSettings);
            }

            await _context.SaveChangesAsync();
            return await GetSettingsAsync();
        }
    }
}
