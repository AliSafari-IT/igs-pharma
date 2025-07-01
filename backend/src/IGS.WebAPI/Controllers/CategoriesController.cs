using System.Text.Json;
using AutoMapper;
using IGS.Application.DTOs;
using IGS.Application.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace IGS.WebAPI.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class CategoriesController : ControllerBase
    {
        private readonly ICategoryService _categoryService;
        private readonly ILogger<CategoriesController> _logger;

        public CategoriesController(
            ICategoryService categoryService,
            ILogger<CategoriesController> logger
        )
        {
            _categoryService = categoryService;
            _logger = logger;
        }

        [HttpGet]
        public async Task<ActionResult<IEnumerable<CategoryDto>>> GetAll()
        {
            try
            {
                _logger.LogInformation("CategoriesController: Getting all categories");
                var categories = await _categoryService.GetAllAsync();
                _logger.LogInformation(
                    $"CategoriesController: Retrieved {categories.Count()} categories successfully"
                );
                return Ok(categories);
            }
            catch (AutoMapperMappingException mapEx)
            {
                _logger.LogError(
                    mapEx,
                    "CategoriesController: AutoMapper error getting all categories: {Message}",
                    mapEx.Message
                );
                if (mapEx.InnerException != null)
                {
                    _logger.LogError("Inner exception: {Message}", mapEx.InnerException.Message);
                }
                return StatusCode(
                    500,
                    new
                    {
                        message = "A mapping error occurred while retrieving categories",
                        details = mapEx.Message,
                        innerError = mapEx.InnerException?.Message,
                    }
                );
            }
            catch (InvalidOperationException opEx)
            {
                _logger.LogError(
                    opEx,
                    "CategoriesController: Operation error getting all categories: {Message}",
                    opEx.Message
                );
                return StatusCode(
                    500,
                    new
                    {
                        message = "An operation error occurred while retrieving categories",
                        details = opEx.Message,
                    }
                );
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "CategoriesController: Error getting all categories: {Message}",
                    ex.Message
                );
                if (ex.InnerException != null)
                {
                    _logger.LogError("Inner exception: {Message}", ex.InnerException.Message);
                }

                // Log the full exception details for debugging
                _logger.LogDebug(
                    "Exception details: {ExceptionDetails}",
                    JsonSerializer.Serialize(
                        new
                        {
                            Message = ex.Message,
                            StackTrace = ex.StackTrace,
                            InnerException = ex.InnerException?.Message,
                            InnerStackTrace = ex.InnerException?.StackTrace,
                        }
                    )
                );

                return StatusCode(
                    500,
                    new
                    {
                        message = "An error occurred while retrieving categories",
                        details = ex.Message,
                        innerError = ex.InnerException?.Message,
                    }
                );
            }
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<CategoryDto>> GetById(int id)
        {
            try
            {
                _logger.LogInformation("CategoriesController: Getting category by ID {Id}", id);
                var category = await _categoryService.GetByIdAsync(id);
                if (category == null)
                {
                    _logger.LogWarning("CategoriesController: Category with ID {Id} not found", id);
                    return NotFound(new { message = $"Category with ID {id} not found" });
                }

                _logger.LogInformation(
                    "CategoriesController: Successfully retrieved category with ID {Id}",
                    id
                );
                return Ok(category);
            }
            catch (AutoMapperMappingException mapEx)
            {
                _logger.LogError(
                    mapEx,
                    "CategoriesController: AutoMapper error getting category by ID {Id}: {Message}",
                    id,
                    mapEx.Message
                );
                return StatusCode(
                    500,
                    new
                    {
                        message = "A mapping error occurred while retrieving the category",
                        details = mapEx.Message,
                    }
                );
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "CategoriesController: Error getting category by ID {Id}: {Message}",
                    id,
                    ex.Message
                );
                return StatusCode(
                    500,
                    new
                    {
                        message = "An error occurred while retrieving the category",
                        details = ex.Message,
                    }
                );
            }
        }

        [HttpPost]
        public async Task<ActionResult<CategoryDto>> Create(CreateCategoryDto createDto)
        {
            try
            {
                _logger.LogInformation(
                    "CategoriesController: Creating new category: {@CategoryDto}",
                    createDto
                );

                if (!ModelState.IsValid)
                {
                    _logger.LogWarning(
                        "CategoriesController: Invalid model state: {@ModelState}",
                        ModelState
                    );
                    return BadRequest(ModelState);
                }

                var category = await _categoryService.CreateAsync(createDto);
                _logger.LogInformation(
                    "CategoriesController: Category created successfully with ID: {CategoryId}",
                    category.Id
                );
                return CreatedAtAction(nameof(GetById), new { id = category.Id }, category);
            }
            catch (AutoMapperMappingException mapEx)
            {
                _logger.LogError(
                    mapEx,
                    "CategoriesController: AutoMapper error creating category: {Message}",
                    mapEx.Message
                );
                return StatusCode(
                    500,
                    new
                    {
                        message = "A mapping error occurred while creating the category",
                        details = mapEx.Message,
                    }
                );
            }
            catch (ArgumentException argEx)
            {
                _logger.LogWarning(
                    argEx,
                    "CategoriesController: Validation error during category creation: {Message}",
                    argEx.Message
                );
                return BadRequest(new { message = argEx.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "CategoriesController: Error creating category: {Message}",
                    ex.Message
                );
                return StatusCode(
                    500,
                    new
                    {
                        message = "An error occurred while creating the category",
                        details = ex.Message,
                    }
                );
            }
        }

        [HttpPut("{id}")]
        public async Task<ActionResult<CategoryDto>> Update(int id, UpdateCategoryDto updateDto)
        {
            try
            {
                _logger.LogInformation(
                    "CategoriesController: Updating category with ID {Id}: {@CategoryDto}",
                    id,
                    updateDto
                );

                if (!ModelState.IsValid)
                {
                    _logger.LogWarning(
                        "CategoriesController: Invalid model state: {@ModelState}",
                        ModelState
                    );
                    return BadRequest(ModelState);
                }

                var category = await _categoryService.UpdateAsync(id, updateDto);
                if (category == null)
                {
                    _logger.LogWarning(
                        "CategoriesController: Category with ID {Id} not found for update",
                        id
                    );
                    return NotFound(new { message = $"Category with ID {id} not found" });
                }

                _logger.LogInformation(
                    "CategoriesController: Category with ID {Id} updated successfully",
                    id
                );
                return Ok(category);
            }
            catch (AutoMapperMappingException mapEx)
            {
                _logger.LogError(
                    mapEx,
                    "CategoriesController: AutoMapper error updating category with ID {Id}: {Message}",
                    id,
                    mapEx.Message
                );
                return StatusCode(
                    500,
                    new
                    {
                        message = "A mapping error occurred while updating the category",
                        details = mapEx.Message,
                    }
                );
            }
            catch (ArgumentException argEx)
            {
                _logger.LogWarning(
                    argEx,
                    "CategoriesController: Validation error during category update: {Message}",
                    argEx.Message
                );
                return BadRequest(new { message = argEx.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "CategoriesController: Error updating category with ID {Id}: {Message}",
                    id,
                    ex.Message
                );
                return StatusCode(
                    500,
                    new
                    {
                        message = "An error occurred while updating the category",
                        details = ex.Message,
                    }
                );
            }
        }

        [HttpDelete("{id}")]
        public async Task<ActionResult> Delete(int id)
        {
            try
            {
                _logger.LogInformation("CategoriesController: Deleting category with ID {Id}", id);
                var result = await _categoryService.DeleteAsync(id);
                if (!result)
                {
                    _logger.LogWarning(
                        "CategoriesController: Category with ID {Id} not found for deletion",
                        id
                    );
                    return NotFound(new { message = $"Category with ID {id} not found" });
                }

                _logger.LogInformation(
                    "CategoriesController: Category with ID {Id} deleted successfully",
                    id
                );
                return NoContent();
            }
            catch (InvalidOperationException opEx)
                when (opEx.Message.Contains("reference") || opEx.Message.Contains("constraint"))
            {
                _logger.LogWarning(
                    opEx,
                    "CategoriesController: Cannot delete category with ID {Id} due to references: {Message}",
                    id,
                    opEx.Message
                );
                return BadRequest(
                    new
                    {
                        message = "This category cannot be deleted because it is referenced by one or more products",
                        details = opEx.Message,
                    }
                );
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "CategoriesController: Error deleting category with ID {Id}: {Message}",
                    id,
                    ex.Message
                );
                return StatusCode(
                    500,
                    new
                    {
                        message = "An error occurred while deleting the category",
                        details = ex.Message,
                    }
                );
            }
        }
    }
}
