@echo off
echo Starting mock data generation and import process...
cd /d D:\repos\igs-pharma\generated-data
node complete-mock-generator.js
node direct-import.js
node validate-import.js
echo Process completed at %time% on %date%
