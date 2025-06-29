import React, { useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
} from '@mui/material';
import {
  Add,
  Remove,
  History,
  Warning,
  TrendingDown,
  TrendingUp,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productApi } from '../services/api';

const Inventory: React.FC = () => {
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [isStockUpdateOpen, setIsStockUpdateOpen] = useState(false);
  const [stockChange, setStockChange] = useState(0);
  const [reason, setReason] = useState('');
  const queryClient = useQueryClient();

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: () => productApi.getAll().then(res => res.data),
  });

  const { data: lowStockProducts = [] } = useQuery({
    queryKey: ['products', 'low-stock'],
    queryFn: () => productApi.getLowStock().then(res => res.data),
  });

  const updateStockMutation = useMutation({
    mutationFn: ({ productId, quantity, reason }: { productId: number; quantity: number; reason: string }) =>
      productApi.updateStock(productId, quantity, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setIsStockUpdateOpen(false);
      setSelectedProduct(null);
      setStockChange(0);
      setReason('');
    },
  });

  const handleStockUpdate = (product: any, type: 'add' | 'remove') => {
    setSelectedProduct(product);
    setStockChange(type === 'add' ? 1 : -1);
    setIsStockUpdateOpen(true);
  };

  const handleStockUpdateSubmit = () => {
    if (selectedProduct && stockChange !== 0) {
      updateStockMutation.mutate({
        productId: selectedProduct.id,
        quantity: stockChange,
        reason: reason || (stockChange > 0 ? 'Stock Addition' : 'Stock Removal'),
      });
    }
  };

  const getStockStatus = (product: any) => {
    if (product.stockQuantity === 0) {
      return { label: 'Out of Stock', color: 'error' as const, icon: <Warning /> };
    }
    if (product.isLowStock) {
      return { label: 'Low Stock', color: 'warning' as const, icon: <TrendingDown /> };
    }
    return { label: 'In Stock', color: 'success' as const, icon: <TrendingUp /> };
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Inventory Management
      </Typography>

      {/* Alerts */}
      {lowStockProducts.length > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          <strong>{lowStockProducts.length}</strong> products are running low on stock and need restocking.
        </Alert>
      )}

      {/* Inventory Summary */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Total Products
              </Typography>
              <Typography variant="h5">
                {products.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Total Stock Value
              </Typography>
              <Typography variant="h5">
                ${products.reduce((sum, p) => sum + (p.price * p.stockQuantity), 0).toLocaleString()}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Low Stock Items
              </Typography>
              <Typography variant="h5" color="warning.main">
                {lowStockProducts.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Out of Stock
              </Typography>
              <Typography variant="h5" color="error.main">
                {products.filter(p => p.stockQuantity === 0).length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Inventory Table */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Current Inventory
          </Typography>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Product</TableCell>
                  <TableCell>SKU</TableCell>
                  <TableCell align="right">Current Stock</TableCell>
                  <TableCell align="right">Min Level</TableCell>
                  <TableCell align="right">Max Level</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {products.map((product) => {
                  const status = getStockStatus(product);
                  return (
                    <TableRow key={product.id}>
                      <TableCell>
                        <Box>
                          <Typography variant="body2" fontWeight="bold">
                            {product.name}
                          </Typography>
                          <Typography variant="caption" color="textSecondary">
                            {product.categoryName}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>{product.sku}</TableCell>
                      <TableCell align="right">
                        <Typography
                          variant="body2"
                          color={product.stockQuantity === 0 ? 'error' : 'inherit'}
                          fontWeight={product.isLowStock ? 'bold' : 'normal'}
                        >
                          {product.stockQuantity}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">{product.minStockLevel}</TableCell>
                      <TableCell align="right">{product.maxStockLevel}</TableCell>
                      <TableCell>
                        <Chip
                          label={status.label}
                          color={status.color}
                          size="small"
                          icon={status.icon}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleStockUpdate(product, 'add')}
                          title="Add Stock"
                        >
                          <Add />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="secondary"
                          onClick={() => handleStockUpdate(product, 'remove')}
                          title="Remove Stock"
                          disabled={product.stockQuantity === 0}
                        >
                          <Remove />
                        </IconButton>
                        <IconButton
                          size="small"
                          title="View History"
                        >
                          <History />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Stock Update Dialog */}
      <Dialog open={isStockUpdateOpen} onClose={() => setIsStockUpdateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Update Stock - {selectedProduct?.name}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              Current Stock: {selectedProduct?.stockQuantity}
            </Typography>
            <TextField
              fullWidth
              label="Stock Change"
              type="number"
              value={stockChange}
              onChange={(e) => setStockChange(parseInt(e.target.value) || 0)}
              margin="normal"
              helperText={stockChange > 0 ? 'Adding stock' : stockChange < 0 ? 'Removing stock' : 'No change'}
            />
            <TextField
              fullWidth
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              margin="normal"
              placeholder="Enter reason for stock change"
            />
            <Typography variant="body2" color="textSecondary" sx={{ mt: 2 }}>
              New Stock Level: {(selectedProduct?.stockQuantity || 0) + stockChange}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsStockUpdateOpen(false)}>Cancel</Button>
          <Button
            onClick={handleStockUpdateSubmit}
            variant="contained"
            disabled={stockChange === 0 || updateStockMutation.isPending}
          >
            {updateStockMutation.isPending ? 'Updating...' : 'Update Stock'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Inventory;
