using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using IGS.Domain.Entities;

namespace IGS.Domain.Interfaces
{
    public interface IPatientRepository : IRepository<Patient>
    {
        Task<IEnumerable<Patient>> SearchAsync(string searchTerm);
        Task<IEnumerable<Patient>> GetByDoctorIdAsync(int doctorId);
    }
}
