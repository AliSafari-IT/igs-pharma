#!/bin/bash

# Create a timestamp for unique SKU/barcode
TIMESTAMP=$(date +%Y%m%d%H%M%S)

# Create JSON payload
cat > test-product.json << EOF
{
  "Name": "Test Bash Product $TIMESTAMP",
  "Description": "Test product via bash script",
  "SKU": "BASH-SKU-$TIMESTAMP",
  "Barcode": "BASH-BARCODE-$TIMESTAMP",
  "Price": 15.99,
  "CostPrice": 8.99,
  "StockQuantity": 50,
  "MinStockLevel": 5,
  "MaxStockLevel": 100,
  "Manufacturer": "Bash Test",
  "BatchNumber": "BASH-BATCH-001",
  "RequiresPrescription": false,
  "CategoryId": 2
}
EOF

echo "Created test product JSON:"
cat test-product.json

echo -e "\nSending request via curl..."
curl -X POST -H "Content-Type: application/json" -d @test-product.json http://localhost:5000/api/Products -v

echo -e "\nDone."
