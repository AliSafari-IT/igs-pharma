#!/bin/bash

# Import Products Script
# This script imports products from a JSON file to the API with proper PascalCase property names

# Configuration
API_URL="http://localhost:5000/api/Products"
JSON_FILE="products.json"
TEMP_FILE="temp_product.json"
SUCCESS_COUNT=0
FAILED_COUNT=0

# Command line arguments
INDEX=-1
OVERRIDE_CATEGORY=false
CATEGORY_ID=1

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -i|--index)
      INDEX="$2"
      shift 2
      ;;
    -c|--category)
      OVERRIDE_CATEGORY=true
      CATEGORY_ID="$2"
      shift 2
      ;;
    -f|--file)
      JSON_FILE="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  -i, --index INDEX      Import only the product at the specified index"
      echo "  -c, --category ID      Override all CategoryId values with the specified ID"
      echo "  -f, --file FILENAME    Use the specified JSON file instead of products_data.json"
      echo "  -h, --help             Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Function to convert camelCase JSON to PascalCase JSON
convert_to_pascal_case() {
    local json="$1"
    
    # Replace property names with PascalCase versions
    json=$(echo "$json" | sed 's/"name":/"Name":/g')
    json=$(echo "$json" | sed 's/"description":/"Description":/g')
    json=$(echo "$json" | sed 's/"sku":/"SKU":/g')
    json=$(echo "$json" | sed 's/"barcode":/"Barcode":/g')
    json=$(echo "$json" | sed 's/"price":/"Price":/g')
    json=$(echo "$json" | sed 's/"costPrice":/"CostPrice":/g')
    json=$(echo "$json" | sed 's/"stockQuantity":/"StockQuantity":/g')
    json=$(echo "$json" | sed 's/"minStockLevel":/"MinStockLevel":/g')
    json=$(echo "$json" | sed 's/"maxStockLevel":/"MaxStockLevel":/g')
    json=$(echo "$json" | sed 's/"expiryDate":/"ExpiryDate":/g')
    json=$(echo "$json" | sed 's/"manufactureDate":/"ManufactureDate":/g')
    json=$(echo "$json" | sed 's/"manufacturer":/"Manufacturer":/g')
    json=$(echo "$json" | sed 's/"batchNumber":/"BatchNumber":/g')
    json=$(echo "$json" | sed 's/"requiresPrescription":/"RequiresPrescription":/g')
    json=$(echo "$json" | sed 's/"categoryId":/"CategoryId":/g')
    json=$(echo "$json" | sed 's/"supplierId":/"SupplierId":/g')
    
    # If overriding category ID, replace the CategoryId value
    if [ "$OVERRIDE_CATEGORY" = true ]; then
        # Extract the original CategoryId for logging
        original_id=$(echo "$json" | grep -o '"CategoryId":[0-9]*' | cut -d':' -f2)
        echo "Overriding CategoryId from $original_id to $CATEGORY_ID"
        
        # Replace the CategoryId value
        json=$(echo "$json" | sed "s/\"CategoryId\":[0-9]*/\"CategoryId\":$CATEGORY_ID/g")
    fi
    
    echo "$json"
}

# Function to import a single product
import_product() {
    local product_json="$1"
    local index="$2"
    
    echo -e "\nAdding product [$index]..."
    
    # Convert to PascalCase
    product_json=$(convert_to_pascal_case "$product_json")
    
    # Save to temporary file
    echo "$product_json" > "$TEMP_FILE"
    
    echo "Sending JSON:"
    cat "$TEMP_FILE"
    
    # Send request with curl
    response=$(curl -s -X POST -H "Content-Type: application/json" -d @"$TEMP_FILE" "$API_URL")
    
    # Check if response contains an ID (success)
    if [[ $response == *"id"* ]]; then
        echo -e "\n✅ Success! Product added."
        ((SUCCESS_COUNT++))
    else
        echo -e "\n❌ Failed to add product."
        echo "Error: $response"
        ((FAILED_COUNT++))
    fi
}

# Display script info
echo "Import Products Script"
echo "======================"
echo "API URL: $API_URL"
echo "JSON File: $JSON_FILE"

if [ "$INDEX" -ge 0 ]; then
    echo "Importing single product at index: $INDEX"
else
    echo "Importing all products"
fi

if [ "$OVERRIDE_CATEGORY" = true ]; then
    echo "Overriding all CategoryId values to: $CATEGORY_ID"
else
    echo "Using original CategoryId values from JSON"
fi
echo "======================"

# Read and process the JSON file
echo "Reading products from $JSON_FILE..."

# Check if jq is available for better JSON parsing
if command -v jq &> /dev/null; then
    echo "Using jq for JSON parsing"
    
    # Get total number of products
    PRODUCT_COUNT=$(jq '. | length' "$JSON_FILE")
    echo "Found $PRODUCT_COUNT products"
    
    # Process products based on index parameter
    if [ "$INDEX" -ge 0 ]; then
        if [ "$INDEX" -lt "$PRODUCT_COUNT" ]; then
            echo "Processing single product at index $INDEX"
            product_json=$(jq -c ".[$INDEX]" "$JSON_FILE")
            import_product "$product_json" "$INDEX"
        else
            echo "Error: Index $INDEX is out of range (0-$((PRODUCT_COUNT-1)))"
            exit 1
        fi
    else
        echo "Processing all $PRODUCT_COUNT products..."
        for i in $(seq 0 $((PRODUCT_COUNT-1))); do
            product_json=$(jq -c ".[$i]" "$JSON_FILE")
            import_product "$product_json" "$i"
        done
    fi
else
    echo "jq not found, using basic parsing (less reliable)"
    
    # Read the file content
    content=$(cat "$JSON_FILE")
    
    # Remove the outer brackets and split by product objects
    content=${content#[}
    content=${content%]}
    
    # Split the content by product objects (this is a simple approach and may not work for all JSON)
    IFS='},' read -ra products <<< "$content"
    
    PRODUCT_COUNT=${#products[@]}
    echo "Found $PRODUCT_COUNT products"
    
    # Process products based on index parameter
    if [ "$INDEX" -ge 0 ]; then
        if [ "$INDEX" -lt "$PRODUCT_COUNT" ]; then
            echo "Processing single product at index $INDEX"
            product_json="${products[$INDEX]}"
            if [[ ! $product_json == *"}"* ]]; then
                product_json="$product_json}"
            fi
            import_product "$product_json" "$INDEX"
        else
            echo "Error: Index $INDEX is out of range (0-$((PRODUCT_COUNT-1)))"
            exit 1
        fi
    else
        echo "Processing all $PRODUCT_COUNT products..."
        for i in "${!products[@]}"; do
            product_json="${products[$i]}"
            if [[ ! $product_json == *"}"* ]]; then
                product_json="$product_json}"
            fi
            import_product "$product_json" "$i"
        done
    fi
fi

# Display summary
echo -e "\n--- Import Summary ---"
echo "Total products processed: $((SUCCESS_COUNT + FAILED_COUNT))"
echo "Successfully added: $SUCCESS_COUNT"
echo "Failed: $FAILED_COUNT"

if [ $FAILED_COUNT -gt 0 ]; then
    echo -e "\nTo retry a specific product, run:"
    echo "$0 --index <number> [--category <id>]"
fi

# Clean up
if [ -f "$TEMP_FILE" ]; then
    rm "$TEMP_FILE"
fi

echo -e "\nDone."
