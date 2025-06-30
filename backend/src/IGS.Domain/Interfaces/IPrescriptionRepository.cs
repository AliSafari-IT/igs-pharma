using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using IGS.Domain.Entities;

namespace IGS.Domain.Interfaces
{
    public interface IPrescriptionRepository : IRepository<Prescription>
    {
        Task<IEnumerable<Prescription>> GetByPatientIdAsync(int patientId);
        Task<IEnumerable<Prescription>> GetByDoctorNameAsync(string doctorName);
        Task<IEnumerable<Prescription>> GetByDateRangeAsync(DateTime startDate, DateTime endDate);
        Task<IEnumerable<Prescription>> GetActiveAsync();
    }
}
