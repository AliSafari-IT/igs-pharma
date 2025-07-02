using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using AutoMapper;
using IGS.Application.DTOs;
using IGS.Domain.Entities;
using IGS.Domain.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace IGS.WebAPI.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class PatientsController : ControllerBase
    {
        private readonly IPatientRepository _patientRepository;
        private readonly IMapper _mapper;
        private readonly ILogger<PatientsController> _logger;

        public PatientsController(
            IPatientRepository patientRepository,
            IMapper mapper,
            ILogger<PatientsController> logger
        )
        {
            _patientRepository = patientRepository;
            _mapper = mapper;
            _logger = logger;
        }

        [HttpGet]
        [Authorize(Policy = "PatientsRead")]
        public async Task<IActionResult> GetAllPatients()
        {
            try
            {
                _logger.LogInformation("PatientsController: Getting all patients");
                var patients = await _patientRepository.GetAllAsync();
                var patientDtos = _mapper.Map<IEnumerable<PatientDto>>(patients);
                _logger.LogInformation(
                    $"PatientsController: Retrieved {patientDtos.Count()} patients successfully"
                );
                return Ok(patientDtos);
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "PatientsController: Error getting all patients: {Message}",
                    ex.Message
                );
                return StatusCode(
                    StatusCodes.Status500InternalServerError,
                    new { message = "An error occurred while retrieving patients" }
                );
            }
        }

        [HttpGet("{id}")]
        [Authorize(Policy = "PatientsRead")]
        public async Task<IActionResult> GetPatientById(int id)
        {
            try
            {
                _logger.LogInformation("PatientsController: Getting patient by ID {Id}", id);
                var patient = await _patientRepository.GetByIdAsync(id);
                if (patient == null)
                {
                    _logger.LogWarning("PatientsController: Patient with ID {Id} not found", id);
                    return NotFound(new { message = $"Patient with ID {id} not found" });
                }

                var patientDto = _mapper.Map<PatientDto>(patient);
                _logger.LogInformation(
                    "PatientsController: Successfully retrieved patient with ID {Id}",
                    id
                );
                return Ok(patientDto);
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "PatientsController: Error getting patient by ID {Id}: {Message}",
                    id,
                    ex.Message
                );
                return StatusCode(
                    StatusCodes.Status500InternalServerError,
                    new { message = "An error occurred while retrieving the patient" }
                );
            }
        }

        [HttpPost]
        [Authorize(Policy = "PatientsViewOrWrite")]
        public async Task<IActionResult> CreatePatient([FromBody] CreatePatientDto createPatientDto)
        {
            try
            {
                _logger.LogInformation(
                    "PatientsController: Creating new patient: {@PatientDto}",
                    createPatientDto
                );

                if (!ModelState.IsValid)
                {
                    _logger.LogWarning(
                        "PatientsController: Invalid model state: {@ModelState}",
                        ModelState
                    );
                    return BadRequest(ModelState);
                }

                var patient = _mapper.Map<Patient>(createPatientDto);
                await _patientRepository.AddAsync(patient);
                await _patientRepository.SaveChangesAsync();

                _logger.LogInformation(
                    "PatientsController: Patient created successfully with ID: {PatientId}",
                    patient.Id
                );

                var patientDto = _mapper.Map<PatientDto>(patient);
                return CreatedAtAction(nameof(GetPatientById), new { id = patient.Id }, patientDto);
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "PatientsController: Error creating patient: {Message}",
                    ex.Message
                );
                return StatusCode(
                    StatusCodes.Status500InternalServerError,
                    new { message = "An error occurred while creating the patient" }
                );
            }
        }

        [HttpPut("{id}")]
        [Authorize(Policy = "PatientsViewOrWrite")]
        public async Task<IActionResult> UpdatePatient(
            int id,
            [FromBody] UpdatePatientDto updatePatientDto
        )
        {
            try
            {
                _logger.LogInformation(
                    "PatientsController: Updating patient with ID {Id}: {@PatientDto}",
                    id,
                    updatePatientDto
                );

                if (!ModelState.IsValid)
                {
                    _logger.LogWarning(
                        "PatientsController: Invalid model state: {@ModelState}",
                        ModelState
                    );
                    return BadRequest(ModelState);
                }

                var patient = await _patientRepository.GetByIdAsync(id);
                if (patient == null)
                {
                    _logger.LogWarning("PatientsController: Patient with ID {Id} not found", id);
                    return NotFound(new { message = $"Patient with ID {id} not found" });
                }

                // Store the current IsActive status before mapping
                bool currentIsActive = patient.IsActive;
                
                // Map all properties from the DTO to the entity
                _mapper.Map(updatePatientDto, patient);
                
                // Always preserve the original IsActive status
                // This ensures patients don't get deactivated accidentally during updates
                patient.IsActive = currentIsActive;

                patient.UpdatedAt = DateTime.UtcNow;

                await _patientRepository.UpdateAsync(patient);
                await _patientRepository.SaveChangesAsync();

                _logger.LogInformation(
                    "PatientsController: Patient with ID {Id} updated successfully",
                    id
                );

                var patientDto = _mapper.Map<PatientDto>(patient);
                return Ok(patientDto);
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "PatientsController: Error updating patient with ID {Id}: {Message}",
                    id,
                    ex.Message
                );
                return StatusCode(
                    StatusCodes.Status500InternalServerError,
                    new { message = "An error occurred while updating the patient" }
                );
            }
        }

        [HttpDelete("{id}")]
        [Authorize(Policy = "PatientsViewOrWrite")]
        public async Task<IActionResult> DeletePatient(int id)
        {
            try
            {
                _logger.LogInformation("PatientsController: Deleting patient with ID {Id}", id);

                var patient = await _patientRepository.GetByIdAsync(id);
                if (patient == null)
                {
                    _logger.LogWarning("PatientsController: Patient with ID {Id} not found", id);
                    return NotFound(new { message = $"Patient with ID {id} not found" });
                }

                _patientRepository.Remove(patient);
                await _patientRepository.SaveChangesAsync();

                _logger.LogInformation(
                    "PatientsController: Patient with ID {Id} deleted successfully",
                    id
                );

                return Ok(new { message = "Patient deleted successfully" });
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "PatientsController: Error deleting patient with ID {Id}: {Message}",
                    id,
                    ex.Message
                );
                return StatusCode(
                    StatusCodes.Status500InternalServerError,
                    new { message = "An error occurred while deleting the patient" }
                );
            }
        }

        [HttpGet("search")]
        [Authorize(Policy = "PatientsRead")]
        public async Task<IActionResult> SearchPatients([FromQuery] string searchTerm)
        {
            try
            {
                _logger.LogInformation(
                    "PatientsController: Searching patients with term: {SearchTerm}",
                    searchTerm
                );

                if (string.IsNullOrWhiteSpace(searchTerm))
                {
                    return BadRequest(new { message = "Search term cannot be empty" });
                }

                var patients = await _patientRepository.SearchAsync(searchTerm);
                var patientDtos = _mapper.Map<IEnumerable<PatientDto>>(patients);

                _logger.LogInformation(
                    "PatientsController: Found {Count} patients matching search term: {SearchTerm}",
                    patientDtos.Count(),
                    searchTerm
                );

                return Ok(patientDtos);
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "PatientsController: Error searching patients with term {SearchTerm}: {Message}",
                    searchTerm,
                    ex.Message
                );
                return StatusCode(
                    StatusCodes.Status500InternalServerError,
                    new { message = "An error occurred while searching for patients" }
                );
            }
        }

        [HttpGet("doctor/{doctorId}")]
        [Authorize(Policy = "PatientsRead")]
        public async Task<IActionResult> GetPatientsByDoctorId(int doctorId)
        {
            try
            {
                _logger.LogInformation(
                    "PatientsController: Getting patients for doctor ID {DoctorId}",
                    doctorId
                );

                var patients = await _patientRepository.GetByDoctorIdAsync(doctorId);
                var patientDtos = _mapper.Map<IEnumerable<PatientDto>>(patients);

                _logger.LogInformation(
                    "PatientsController: Found {Count} patients for doctor ID {DoctorId}",
                    patientDtos.Count(),
                    doctorId
                );

                return Ok(patientDtos);
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "PatientsController: Error getting patients for doctor ID {DoctorId}: {Message}",
                    doctorId,
                    ex.Message
                );
                return StatusCode(
                    StatusCodes.Status500InternalServerError,
                    new { message = "An error occurred while retrieving patients for the doctor" }
                );
            }
        }
    }
}
