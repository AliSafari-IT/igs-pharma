# PowerShell script to generate SQL schema from Entity Framework migrations
$projectDir = "D:\repos\igs-pharma\backend\src\IGS.Infrastructure"
$startupProjectDir = "D:\repos\igs-pharma\backend\src\IGS.API"
$sqlOutputPath = "D:\repos\igs-pharma\database-schema.sql"
$configPath = "D:\repos\igs-pharma\setup-data.yml"

# Read database config
$yamlContent = Get-Content -Path $configPath -Raw
$yamlPattern = "database:.*?host:\s*(.*?)\s*port:\s*(\d+)\s*user:\s*(.*?)\s*password:\s*(.*?)\s*database:\s*(.*?)(\s*|$)"
$match = [regex]::Match($yamlContent, $yamlPattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)

if ($match.Success) {
    $dbHost = $match.Groups[1].Value.Trim()
    $dbPort = $match.Groups[2].Value.Trim()
    $dbUser = $match.Groups[3].Value.Trim()
    $dbPassword = $match.Groups[4].Value.Trim()
    $dbName = $match.Groups[5].Value.Trim()
    
    Write-Host "Database configuration found:" -ForegroundColor Cyan
    Write-Host "Host: $dbHost" -ForegroundColor Yellow
    Write-Host "Port: $dbPort" -ForegroundColor Yellow
    Write-Host "User: $dbUser" -ForegroundColor Yellow
    Write-Host "Database: $dbName" -ForegroundColor Yellow
    
    # Generate SQL from migrations
    Write-Host "`nGenerating SQL schema from Entity Framework migrations..." -ForegroundColor Cyan
    Push-Location $projectDir
    & dotnet ef migrations script --startup-project $startupProjectDir --output $sqlOutputPath --idempotent
    $efResult = $?
    Pop-Location
    
    if ($efResult -and (Test-Path $sqlOutputPath)) {
        Write-Host "✅ SQL schema generated successfully at: $sqlOutputPath" -ForegroundColor Green
        
        # Create a batch file with the MySQL command
        $mysqlCmdPath = "D:\repos\igs-pharma\apply-schema.cmd"
        $mysqlCmd = "mysql -h $dbHost -P $dbPort -u $dbUser -p$dbPassword $dbName < $sqlOutputPath"
        Set-Content -Path $mysqlCmdPath -Value $mysqlCmd
        
        Write-Host "`nTo apply the schema to your database, run:" -ForegroundColor Cyan
        Write-Host "apply-schema.cmd" -ForegroundColor Yellow
        
        # Also generate a simple MySQL connection test command
        $testCmdPath = "D:\repos\igs-pharma\test-mysql-connection.cmd"
        $testCmd = "mysql -h $dbHost -P $dbPort -u $dbUser -p$dbPassword -e ""SHOW DATABASES;"""
        Set-Content -Path $testCmdPath -Value $testCmd
        
        Write-Host "`nTo test your MySQL connection, run:" -ForegroundColor Cyan
        Write-Host "test-mysql-connection.cmd" -ForegroundColor Yellow
    } else {
        Write-Host "❌ Error generating SQL schema. Please check Entity Framework error messages." -ForegroundColor Red
    }
} else {
    Write-Host "❌ Could not extract database configuration from $configPath" -ForegroundColor Red
}
