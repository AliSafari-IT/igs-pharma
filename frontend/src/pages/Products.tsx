import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Grid,
  Card,
  CardContent,
  CardActions,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  InputAdornment,
  Alert,
  Fab,
} from '@mui/material';
import {
  Search,
  Add,
  Edit,
  Delete,
  Warning,
  CheckCircle,
  FilterList,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productApi } from '../services/api';
import { Product } from '../types/Product';
import ProductForm from '../components/Products/ProductForm';

const Products: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const queryClient = useQueryClient();

  const { data: products = [], isLoading, error } = useQuery({
    queryKey: ['products', searchTerm],
    queryFn: () => {
      if (searchTerm.trim()) {
        return productApi.search(searchTerm).then(res => res.data);
      }
      return productApi.getAll().then(res => res.data);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => productApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setIsDeleteDialogOpen(false);
      setProductToDelete(null);
    },
  });

  const handleEdit = (product: Product) => {
    setSelectedProduct(product);
    setIsFormOpen(true);
  };

  const handleDelete = (product: Product) => {
    setProductToDelete(product);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (productToDelete) {
      deleteMutation.mutate(productToDelete.id);
    }
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setSelectedProduct(null);
  };

  const handleFormSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['products'] });
    handleFormClose();
  };

  const getStockStatus = (product: Product) => {
    if (product.isLowStock) {
      return { label: 'Low Stock', color: 'warning' as const, icon: <Warning /> };
    }
    if (product.stockQuantity === 0) {
      return { label: 'Out of Stock', color: 'error' as const, icon: <Warning /> };
    }
    return { label: 'In Stock', color: 'success' as const, icon: <CheckCircle /> };
  };

  if (error) {
    return (
      <Alert severity="error">
        Failed to load products. Please try again.
      </Alert>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Products</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setIsFormOpen(true)}
        >
          Add Product
        </Button>
      </Box>

      {/* Search and Filters */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <TextField
            fullWidth
            placeholder="Search products..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search />
                </InputAdornment>
              ),
            }}
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <Button
            variant="outlined"
            startIcon={<FilterList />}
            sx={{ height: '56px' }}
          >
            Filters
          </Button>
        </Grid>
      </Grid>

      {/* Products Grid */}
      {isLoading ? (
        <Typography>Loading products...</Typography>
      ) : (
        <Grid container spacing={3}>
          {products.map((product) => {
            const stockStatus = getStockStatus(product);
            return (
              <Grid item xs={12} sm={6} md={4} lg={3} key={product.id}>
                <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <CardContent sx={{ flexGrow: 1 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                      <Typography variant="h6" component="h2" noWrap>
                        {product.name}
                      </Typography>
                      <Chip
                        label={stockStatus.label}
                        color={stockStatus.color}
                        size="small"
                        icon={stockStatus.icon}
                      />
                    </Box>
                    
                    <Typography color="textSecondary" gutterBottom>
                      SKU: {product.sku}
                    </Typography>
                    
                    <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                      {product.description}
                    </Typography>
                    
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                      <Typography variant="h6" color="primary">
                        ${product.price.toFixed(2)}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        Stock: {product.stockQuantity}
                      </Typography>
                    </Box>
                    
                    <Typography variant="body2" color="textSecondary">
                      Category: {product.categoryName}
                    </Typography>
                    
                    {product.requiresPrescription && (
                      <Chip
                        label="Prescription Required"
                        color="info"
                        size="small"
                        sx={{ mt: 1 }}
                      />
                    )}
                    
                    {product.isExpiringSoon && (
                      <Chip
                        label="Expiring Soon"
                        color="error"
                        size="small"
                        sx={{ mt: 1, ml: 1 }}
                      />
                    )}
                  </CardContent>
                  
                  <CardActions>
                    <IconButton
                      size="small"
                      onClick={() => handleEdit(product)}
                      color="primary"
                    >
                      <Edit />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => handleDelete(product)}
                      color="error"
                    >
                      <Delete />
                    </IconButton>
                  </CardActions>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      {products.length === 0 && !isLoading && (
        <Box textAlign="center" py={4}>
          <Typography variant="h6" color="textSecondary">
            No products found
          </Typography>
          <Typography variant="body2" color="textSecondary">
            {searchTerm ? 'Try adjusting your search terms' : 'Start by adding your first product'}
          </Typography>
        </Box>
      )}

      {/* Product Form Dialog */}
      <ProductForm
        open={isFormOpen}
        product={selectedProduct}
        onClose={handleFormClose}
        onSuccess={handleFormSuccess}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onClose={() => setIsDeleteDialogOpen(false)}>
        <DialogTitle>Delete Product</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete "{productToDelete?.name}"? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Products;
