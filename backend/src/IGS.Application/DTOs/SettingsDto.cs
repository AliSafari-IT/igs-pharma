using System;

namespace IGS.Application.DTOs
{
    public class SettingsDto
    {
        public int Id { get; set; }
        public string PharmacyName { get; set; } = string.Empty;
        public string Address { get; set; } = string.Empty;
        public string Phone { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;

        // Notification Settings
        public bool LowStockAlerts { get; set; }
        public bool ExpiryAlerts { get; set; }
        public bool PrescriptionReminders { get; set; }
        public bool EmailNotifications { get; set; }
        public bool SmsNotifications { get; set; }

        // Inventory Settings
        public bool AutoReorder { get; set; }
        public int ReorderThreshold { get; set; }
        public string DefaultSupplier { get; set; } = string.Empty;

        // Security Settings
        public int SessionTimeout { get; set; }
        public bool RequirePasswordChange { get; set; }
        public bool TwoFactorAuth { get; set; }

        // Backup Settings
        public bool AutoBackup { get; set; }
        public string BackupFrequency { get; set; } = string.Empty;
        public int RetentionDays { get; set; }

        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }

    public class UpdateSettingsDto
    {
        public string PharmacyName { get; set; } = string.Empty;
        public string Address { get; set; } = string.Empty;
        public string Phone { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;

        // Notification Settings
        public bool LowStockAlerts { get; set; }
        public bool ExpiryAlerts { get; set; }
        public bool PrescriptionReminders { get; set; }
        public bool EmailNotifications { get; set; }
        public bool SmsNotifications { get; set; }

        // Inventory Settings
        public bool AutoReorder { get; set; }
        public int ReorderThreshold { get; set; }
        public string DefaultSupplier { get; set; } = string.Empty;

        // Security Settings
        public int SessionTimeout { get; set; }
        public bool RequirePasswordChange { get; set; }
        public bool TwoFactorAuth { get; set; }

        // Backup Settings
        public bool AutoBackup { get; set; }
        public string BackupFrequency { get; set; } = string.Empty;
        public int RetentionDays { get; set; }
    }
}
