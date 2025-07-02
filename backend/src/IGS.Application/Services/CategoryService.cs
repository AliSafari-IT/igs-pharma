using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using AutoMapper;
using IGS.Application.DTOs;
using IGS.Application.Interfaces;
using IGS.Domain.Entities;
using IGS.Domain.Interfaces;
using Microsoft.Extensions.Logging;

namespace IGS.Application.Services
{
    public class CategoryService : ICategoryService
    {
        private readonly ICategoryRepository _categoryRepository;
        private readonly IMapper _mapper;
        private readonly ILogger<CategoryService> _logger;

        public CategoryService(
            ICategoryRepository categoryRepository,
            IMapper mapper,
            ILogger<CategoryService> logger
        )
        {
            _categoryRepository = categoryRepository;
            _mapper = mapper;
            _logger = logger;
        }

        public async Task<IEnumerable<CategoryListDto>> GetAllAsync()
        {
            try
            {
                _logger.LogInformation("Fetching all categories");

                // Log repository call
                _logger.LogInformation("Calling _categoryRepository.GetAllAsync()");
                var categories = await _categoryRepository.GetAllAsync();

                // Log categories count
                _logger.LogInformation($"Found {categories.Count()} categories");

                // Log before mapping
                _logger.LogInformation("Starting mapping categories to CategoryListDto");

                // Check if categories is null
                if (categories == null)
                {
                    _logger.LogWarning("Categories collection is null");
                    return new List<CategoryListDto>();
                }

                try
                {
                    var result = _mapper.Map<IEnumerable<CategoryListDto>>(categories);
                    _logger.LogInformation("Successfully mapped categories to CategoryListDto");
                    return result;
                }
                catch (Exception mapEx)
                {
                    _logger.LogError(mapEx, "Error mapping categories to CategoryListDto");
                    throw new Exception("Error mapping categories to DTOs", mapEx);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching categories: {Message}", ex.Message);
                if (ex.InnerException != null)
                {
                    _logger.LogError("Inner exception: {Message}", ex.InnerException.Message);
                }
                throw;
            }
        }

        public async Task<CategoryDto?> GetByIdAsync(int id)
        {
            var category = await _categoryRepository.GetByIdAsync(id);
            return category == null ? null : _mapper.Map<CategoryDto>(category);
        }

        public async Task<CategoryDto> CreateAsync(CreateCategoryDto createDto)
        {
            var category = _mapper.Map<Category>(createDto);
            category.CreatedAt = DateTime.UtcNow;
            category.IsActive = true;

            await _categoryRepository.AddAsync(category);

            return _mapper.Map<CategoryDto>(category);
        }

        public async Task<CategoryDto?> UpdateAsync(int id, UpdateCategoryDto updateDto)
        {
            var category = await _categoryRepository.GetByIdAsync(id);
            if (category == null)
                return null;

            _mapper.Map(updateDto, category);
            category.UpdatedAt = DateTime.UtcNow;
            await _categoryRepository.UpdateAsync(category);

            return _mapper.Map<CategoryDto>(category);
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var category = await _categoryRepository.GetByIdAsync(id);
            if (category == null)
                return false;

            category.IsActive = false;
            category.UpdatedAt = DateTime.UtcNow;
            _categoryRepository.Remove(category);

            return true;
        }
    }
}
