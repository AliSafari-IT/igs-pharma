using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using IGS.Domain.Entities;
using IGS.Domain.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace IGS.Infrastructure.Data.Repositories
{
    public class PrescriptionRepository : Repository<Prescription>, IPrescriptionRepository
    {
        public PrescriptionRepository(PharmacyDbContext context)
            : base(context) { }

        public async Task<IEnumerable<Prescription>> GetByPatientIdAsync(int patientId)
        {
            return await _context
                .Prescriptions.Where(p => p.PatientId == patientId)
                .Include(p => p.PrescriptionItems)
                .OrderByDescending(p => p.PrescriptionDate)
                .ToListAsync();
        }

        public async Task<IEnumerable<Prescription>> GetByDoctorNameAsync(string doctorName)
        {
            return await _context
                .Prescriptions.Where(p => p.DoctorName == doctorName)
                .Include(p => p.PrescriptionItems)
                .OrderByDescending(p => p.PrescriptionDate)
                .ToListAsync();
        }

        public async Task<IEnumerable<Prescription>> GetByDateRangeAsync(
            DateTime startDate,
            DateTime endDate
        )
        {
            return await _context
                .Prescriptions.Where(p =>
                    p.PrescriptionDate >= startDate && p.PrescriptionDate <= endDate
                )
                .Include(p => p.PrescriptionItems)
                .OrderByDescending(p => p.PrescriptionDate)
                .ToListAsync();
        }

        public async Task<IEnumerable<Prescription>> GetActiveAsync()
        {
            return await _context
                .Prescriptions.Where(p => p.IsActive)
                .Include(p => p.PrescriptionItems)
                .OrderByDescending(p => p.PrescriptionDate)
                .ToListAsync();
        }
    }
}
