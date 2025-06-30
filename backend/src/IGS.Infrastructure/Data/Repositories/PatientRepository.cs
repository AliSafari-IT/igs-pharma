using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using IGS.Domain.Entities;
using IGS.Domain.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace IGS.Infrastructure.Data.Repositories
{
    public class PatientRepository : Repository<Patient>, IPatientRepository
    {
        public PatientRepository(PharmacyDbContext context)
            : base(context) { }

        public async Task<IEnumerable<Patient>> SearchAsync(string searchTerm)
        {
            if (string.IsNullOrWhiteSpace(searchTerm))
                return await GetAllAsync();

            return await _context
                .Patients.Where(p =>
                    p.FirstName.Contains(searchTerm)
                    || p.LastName.Contains(searchTerm)
                    || p.Email.Contains(searchTerm)
                    || p.Phone.Contains(searchTerm)
                )
                .ToListAsync();
        }

        public async Task<IEnumerable<Patient>> GetByDoctorIdAsync(int doctorId)
        {
            return await _context.Patients.Where(p => p.DoctorId == doctorId).ToListAsync();
        }
    }
}
