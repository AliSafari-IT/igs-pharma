using System.Security.Claims;
using System.Text;
using IGS.Application.Interfaces;
using IGS.Application.Services;
using IGS.Application.Services.Interfaces;
using IGS.Domain.Entities;
using IGS.Domain.Interfaces;
using IGS.Domain.Repositories;
using IGS.Infrastructure.Data;
using IGS.Infrastructure.Data.Repositories;
using IGS.Infrastructure.Repositories;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder
    .Services.AddControllers()
    .AddJsonOptions(options =>
    {
        // Configure case-insensitive property binding
        options.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
        // Handle circular references
        options.JsonSerializerOptions.ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles;
        // Ensure proper formatting
        options.JsonSerializerOptions.WriteIndented = true;
    });

// Database configuration
builder.Services.AddDbContext<PharmacyDbContext>(options =>
{
    options.UseMySql(
        builder.Configuration.GetConnectionString("DefaultConnection"),
        ServerVersion.AutoDetect(builder.Configuration.GetConnectionString("DefaultConnection"))
    );
});

// AutoMapper configuration
builder.Services.AddAutoMapper(cfg =>
{
    // Explicitly register mapping profiles from WebAPI project
    cfg.AddProfile<IGS.WebAPI.Mappings.CategoryMappingProfile>();
    cfg.AddProfile<IGS.WebAPI.Mappings.SupplierMappingProfile>();
    cfg.AddProfile<IGS.WebAPI.Mappings.SettingsMappingProfile>();

    // Also scan assemblies for other profiles
    cfg.AddMaps(typeof(Program).Assembly);
    cfg.AddMaps(typeof(IGS.Application.Mappings.MappingProfile).Assembly);
});

// JWT Authentication
var jwtKey =
    builder.Configuration["Jwt:Key"]
    ?? throw new InvalidOperationException("JWT Key is not configured");
var key = Encoding.ASCII.GetBytes(jwtKey);

builder
    .Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
        options.SaveToken = true;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(key),
            ValidateIssuer = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidateAudience = true,
            ValidAudience = builder.Configuration["Jwt:Audience"],
            ClockSkew = TimeSpan.Zero,
        };
    });

builder
    .Services.AddAuthorizationBuilder()
    .AddPolicy("ProductsWrite", policy => policy.RequireClaim("Permission", "products.write"))
    .AddPolicy("ProductsRead", policy => policy.RequireClaim("Permission", "products.read"))
    .AddPolicy("CategoriesRead", policy => policy.RequireClaim("Permission", "categories.read"))
    .AddPolicy("CategoriesWrite", policy => policy.RequireClaim("Permission", "categories.write"))
    .AddPolicy("SuppliersRead", policy => policy.RequireClaim("Permission", "suppliers.read"))
    .AddPolicy("SuppliersWrite", policy => policy.RequireClaim("Permission", "suppliers.write"))
    .AddPolicy("InventoryRead", policy => policy.RequireClaim("Permission", "inventory.read"))
    .AddPolicy("InventoryWrite", policy => policy.RequireClaim("Permission", "inventory.write"))
    .AddPolicy("SalesRead", policy => policy.RequireClaim("Permission", "sales.read"))
    .AddPolicy("SalesWrite", policy => policy.RequireClaim("Permission", "sales.write"))
    .AddPolicy("PatientsRead", policy => policy.RequireClaim("Permission", "patients.read"))
    .AddPolicy("PatientsWrite", policy => policy.RequireClaim("Permission", "patients.write"))
    .AddPolicy(
        "PatientsViewOrWrite",
        policy =>
            policy.RequireAssertion(context =>
                context.User.HasClaim(c =>
                    c.Type == "Permission"
                    && (c.Value == "patients.view" || c.Value == "patients.write")
                )
            )
    )
    .AddPolicy("SettingsRead", policy => policy.RequireClaim("Permission", "settings.read"))
    .AddPolicy("SettingsWrite", policy => policy.RequireClaim("Permission", "settings.write"))
    .AddPolicy(
        "UsersViewOrWrite",
        policy =>
            policy.RequireAssertion(context =>
                context.User.HasClaim(c =>
                    c.Type == "Permission" && (c.Value == "users.view" || c.Value == "users.write")
                )
            )
    )
    .AddPolicy("Admin", policy => policy.RequireClaim("Role", "Admin"));

// Repositories
builder.Services.AddScoped<IRepository<Product>, Repository<Product>>();
builder.Services.AddScoped<IProductRepository, ProductRepository>();
builder.Services.AddScoped<ICategoryRepository, CategoryRepository>();
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<ISupplierRepository, SupplierRepository>();
builder.Services.AddScoped<IInventoryTransactionRepository, InventoryTransactionRepository>();
builder.Services.AddScoped<IPatientRepository, PatientRepository>();
builder.Services.AddScoped<IPrescriptionRepository, PrescriptionRepository>();
builder.Services.AddScoped<ISaleRepository, SaleRepository>();
builder.Services.AddScoped<ISettingsRepository, SettingsRepository>();

// Application services
builder.Services.AddScoped<IProductService, ProductService>();
builder.Services.AddScoped<ICategoryService, CategoryService>();
builder.Services.AddScoped<ISupplierService, SupplierService>();
builder.Services.AddScoped<IUserService, UserService>();
builder.Services.AddScoped<ISettingsService, SettingsService>();

// CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy(
        "AllowReactApp",
        policy =>
        {
            policy
                .WithOrigins(
                    "http://localhost:3000",
                    "https://localhost:3000",
                    "http://localhost:5173",
                    "https://localhost:5173"
                )
                .AllowAnyHeader()
                .AllowAnyMethod()
                .AllowCredentials();
        }
    );
});

// Swagger/OpenAPI
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc(
        "v1",
        new OpenApiInfo
        {
            Title = "IGS Pharma API",
            Version = "v1",
            Description = "Pharmacy Management System API",
        }
    );
});

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "IGS Pharma API V1");
        c.RoutePrefix = string.Empty; // Set Swagger UI at the app's root
    });
}

// Only use HTTPS redirection in production
if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

app.UseCors("AllowReactApp");

app.UseAuthentication();

app.UseAuthorization();

app.MapControllers();

// Ensure database is created
using (var scope = app.Services.CreateScope())
{
    var context = scope.ServiceProvider.GetRequiredService<PharmacyDbContext>();
    context.Database.EnsureCreated();
}

app.Run();
