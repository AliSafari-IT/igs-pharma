# Script to apply EF Core database migrations for IGS Pharma
# This will create all database tables needed for importing data

Write-Host "Applying database migrations for IGS Pharma..." -ForegroundColor Cyan

# Navigate to the project directory
Set-Location "D:\repos\igs-pharma\backend\src\IGS.Infrastructure"

# Apply migrations to the database
Write-Host "Running dotnet ef database update..." -ForegroundColor Yellow
dotnet ef database update --startup-project "../IGS.API" --verbose

# Check if the command was successful
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Database migrations applied successfully!" -ForegroundColor Green
    Write-Host "You can now run the data import script." -ForegroundColor Cyan
} else {
    Write-Host "❌ Error applying migrations. Please check the output above." -ForegroundColor Red
}

# Return to original directory
Set-Location "D:\repos\igs-pharma"
