@echo off
REM Apply database schema to MySQL database
echo Creating database schema...
mysql -h localhost -P 3306 -u root -pAli+123456/ igs_pharma_db < create-schema.sql
if %ERRORLEVEL% EQU 0 (
  echo Schema applied successfully!
  echo You can now run the data import script.
) else (
  echo Error applying schema. Please check error messages.
)
pause
