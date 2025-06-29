import React, { useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Autocomplete,
  IconButton,
  Fab,
} from '@mui/material';
import {
  Add,
  Edit,
  Delete,
  Receipt,
  AttachMoney,
  ShoppingCart,
  Person,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salesApi, productApi, patientApi } from '../services/api';

const Sales: React.FC = () => {
  const [isSaleDialogOpen, setIsSaleDialogOpen] = useState(false);
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [saleItems, setSaleItems] = useState<any[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const queryClient = useQueryClient();

  const { data: sales = [], isLoading } = useQuery({
    queryKey: ['sales'],
    queryFn: () => salesApi.getAll().then(res => res.data),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => productApi.getAll().then(res => res.data),
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => patientApi.getAll().then(res => res.data),
  });

  const createSaleMutation = useMutation({
    mutationFn: (saleData: any) => salesApi.create(saleData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      setIsSaleDialogOpen(false);
      resetSaleForm();
    },
  });

  const resetSaleForm = () => {
    setSaleItems([]);
    setSelectedPatient(null);
    setSelectedSale(null);
  };

  const addSaleItem = () => {
    setSaleItems([...saleItems, { productId: 0, quantity: 1, unitPrice: 0 }]);
  };

  const removeSaleItem = (index: number) => {
    setSaleItems(saleItems.filter((_, i) => i !== index));
  };

  const updateSaleItem = (index: number, field: string, value: any) => {
    const updatedItems = [...saleItems];
    updatedItems[index] = { ...updatedItems[index], [field]: value };
    
    if (field === 'productId') {
      const product = products.find(p => p.id === value);
      if (product) {
        updatedItems[index].unitPrice = product.price;
      }
    }
    
    setSaleItems(updatedItems);
  };

  const calculateTotal = () => {
    return saleItems.reduce((total, item) => total + (item.quantity * item.unitPrice), 0);
  };

  const handleCreateSale = () => {
    const saleData = {
      patientId: selectedPatient?.id,
      items: saleItems.filter(item => item.productId > 0),
      totalAmount: calculateTotal(),
      paymentMethod: 'Cash', // Default for now
      status: 'Completed',
    };

    createSaleMutation.mutate(saleData);
  };

  const getSaleStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed': return 'success';
      case 'pending': return 'warning';
      case 'cancelled': return 'error';
      default: return 'default';
    }
  };

  // Mock data for today's sales summary
  const todaysSales = sales.filter((sale: { saleDate: string | number | Date; }) => 
    new Date(sale.saleDate).toDateString() === new Date().toDateString()
  );
  const todaysRevenue = todaysSales.reduce((sum: any, sale: { totalAmount: any; }) => sum + sale.totalAmount, 0);

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Sales Management</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setIsSaleDialogOpen(true)}
        >
          New Sale
        </Button>
      </Box>

      {/* Sales Summary */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center">
                <AttachMoney color="success" sx={{ mr: 2 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Today's Revenue
                  </Typography>
                  <Typography variant="h5">
                    ${todaysRevenue.toFixed(2)}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center">
                <Receipt color="primary" sx={{ mr: 2 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Today's Sales
                  </Typography>
                  <Typography variant="h5">
                    {todaysSales.length}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center">
                <ShoppingCart color="info" sx={{ mr: 2 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Total Sales
                  </Typography>
                  <Typography variant="h5">
                    {sales.length}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center">
                <Person color="secondary" sx={{ mr: 2 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Avg. Sale Value
                  </Typography>
                  <Typography variant="h5">
                    ${sales.length > 0 ? (sales.reduce((sum: any, s: { totalAmount: any; }) => sum + s.totalAmount, 0) / sales.length).toFixed(2) : '0.00'}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Sales Table */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Recent Sales
          </Typography>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Sale ID</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Patient</TableCell>
                  <TableCell align="right">Total Amount</TableCell>
                  <TableCell>Payment Method</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sales.map((sale: any) => (
                  <TableRow key={sale.id}>
                    <TableCell>#{sale.id}</TableCell>
                    <TableCell>
                      {new Date(sale.saleDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell>{sale.patientName || 'Walk-in Customer'}</TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight="bold">
                        ${sale.totalAmount.toFixed(2)}
                      </Typography>
                    </TableCell>
                    <TableCell>{sale.paymentMethod}</TableCell>
                    <TableCell>
                      <Chip
                        label={sale.status}
                        color={getSaleStatusColor(sale.status) as any}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="center">
                      <IconButton size="small" color="primary">
                        <Receipt />
                      </IconButton>
                      <IconButton size="small" color="secondary">
                        <Edit />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* New Sale Dialog */}
      <Dialog open={isSaleDialogOpen} onClose={() => setIsSaleDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create New Sale</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Autocomplete
                  options={patients}
                  getOptionLabel={(option) => `${option.firstName} ${option.lastName} - ${option.phoneNumber}`}
                  value={selectedPatient}
                  onChange={(_, newValue) => setSelectedPatient(newValue)}
                  renderInput={(params) => (
                    <TextField {...params} label="Patient (Optional)" fullWidth />
                  )}
                />
              </Grid>
              
              <Grid item xs={12}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                  <Typography variant="h6">Sale Items</Typography>
                  <Button startIcon={<Add />} onClick={addSaleItem}>
                    Add Item
                  </Button>
                </Box>
                
                {saleItems.map((item, index) => (
                  <Grid container spacing={2} key={index} sx={{ mb: 2 }}>
                    <Grid item xs={5}>
                      <Autocomplete
                        options={products}
                        getOptionLabel={(option) => `${option.name} - ${option.sku}`}
                        value={products.find(p => p.id === item.productId) || null}
                        onChange={(_, newValue) => updateSaleItem(index, 'productId', newValue?.id || 0)}
                        renderInput={(params) => (
                          <TextField {...params} label="Product" size="small" />
                        )}
                      />
                    </Grid>
                    <Grid item xs={2}>
                      <TextField
                        label="Quantity"
                        type="number"
                        size="small"
                        value={item.quantity}
                        onChange={(e) => updateSaleItem(index, 'quantity', parseInt(e.target.value) || 1)}
                        inputProps={{ min: 1 }}
                      />
                    </Grid>
                    <Grid item xs={2}>
                      <TextField
                        label="Unit Price"
                        type="number"
                        size="small"
                        value={item.unitPrice}
                        onChange={(e) => updateSaleItem(index, 'unitPrice', parseFloat(e.target.value) || 0)}
                        inputProps={{ step: '0.01', min: '0' }}
                      />
                    </Grid>
                    <Grid item xs={2}>
                      <TextField
                        label="Total"
                        size="small"
                        value={(item.quantity * item.unitPrice).toFixed(2)}
                        InputProps={{ readOnly: true }}
                      />
                    </Grid>
                    <Grid item xs={1}>
                      <IconButton onClick={() => removeSaleItem(index)} color="error">
                        <Delete />
                      </IconButton>
                    </Grid>
                  </Grid>
                ))}
                
                <Box textAlign="right" mt={2}>
                  <Typography variant="h6">
                    Total: ${calculateTotal().toFixed(2)}
                  </Typography>
                </Box>
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsSaleDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleCreateSale}
            variant="contained"
            disabled={saleItems.length === 0 || createSaleMutation.isPending}
          >
            {createSaleMutation.isPending ? 'Creating...' : 'Create Sale'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Sales;
