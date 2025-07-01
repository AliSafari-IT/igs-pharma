using System;
using System.Threading.Tasks;
using IGS.Application.DTOs;
using IGS.Application.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace IGS.WebAPI.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class SettingsController : ControllerBase
    {
        private readonly ISettingsService _settingsService;
        private readonly ILogger<SettingsController> _logger;

        public SettingsController(
            ISettingsService settingsService,
            ILogger<SettingsController> logger
        )
        {
            _settingsService = settingsService;
            _logger = logger;
        }

        [HttpGet]
        [Authorize(Policy = "SettingsRead")]
        public async Task<ActionResult<SettingsDto>> GetSettings()
        {
            try
            {
                _logger.LogInformation("Getting settings");
                var settings = await _settingsService.GetSettingsAsync();
                return Ok(settings);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting settings");
                return StatusCode(
                    500,
                    new
                    {
                        message = "An error occurred while retrieving settings",
                        error = ex.Message,
                    }
                );
            }
        }

        [HttpPut]
        [Authorize(Policy = "SettingsWrite")]
        public async Task<ActionResult<SettingsDto>> UpdateSettings(
            [FromBody] UpdateSettingsDto updateSettingsDto
        )
        {
            if (!ModelState.IsValid)
            {
                _logger.LogWarning("Invalid settings update request");
                return BadRequest(ModelState);
            }

            try
            {
                _logger.LogInformation("Updating settings");
                var updatedSettings = await _settingsService.UpdateSettingsAsync(updateSettingsDto);
                return Ok(updatedSettings);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating settings");
                return StatusCode(
                    500,
                    new
                    {
                        message = "An error occurred while updating settings",
                        error = ex.Message,
                    }
                );
            }
        }
    }
}
