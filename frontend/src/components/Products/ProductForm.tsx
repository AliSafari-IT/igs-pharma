import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  FormControlLabel,
  Switch,
  MenuItem,
  Box,
} from '@mui/material';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import { useMutation, useQuery } from '@tanstack/react-query';
import { productApi, categoryApi, supplierApi } from '../../services/api';
import { Product, CreateProduct, UpdateProduct } from '../../types/Product';

interface ProductFormProps {
  open: boolean;
  product?: Product | null;
  onClose: () => void;
  onSuccess: () => void;
}

const validationSchema = Yup.object({
  name: Yup.string().required('Name is required'),
  sku: Yup.string().required('SKU is required'),
  price: Yup.number().min(0, 'Price must be positive').required('Price is required'),
  costPrice: Yup.number().min(0, 'Cost price must be positive').required('Cost price is required'),
  stockQuantity: Yup.number().min(0, 'Stock quantity must be positive').required('Stock quantity is required'),
  minStockLevel: Yup.number().min(0, 'Min stock level must be positive').required('Min stock level is required'),
  maxStockLevel: Yup.number().min(0, 'Max stock level must be positive').required('Max stock level is required'),
  categoryId: Yup.number().required('Category is required'),
  manufacturer: Yup.string().required('Manufacturer is required'),
});

const ProductForm: React.FC<ProductFormProps> = ({ open, product, onClose, onSuccess }) => {
  const isEditing = !!product;

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoryApi.getAll().then(res => res.data),
    enabled: open,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => supplierApi.getAll().then(res => res.data),
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateProduct) => productApi.create(data),
    onSuccess: () => {
      onSuccess();
      formik.resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateProduct }) => productApi.update(id, data),
    onSuccess: () => {
      onSuccess();
      formik.resetForm();
    },
  });

  const formik = useFormik({
    initialValues: {
      name: product?.name || '',
      description: product?.description || '',
      sku: product?.sku || '',
      barcode: product?.barcode || '',
      price: product?.price || 0,
      costPrice: product?.costPrice || 0,
      stockQuantity: product?.stockQuantity || 0,
      minStockLevel: product?.minStockLevel || 0,
      maxStockLevel: product?.maxStockLevel || 0,
      expiryDate: product?.expiryDate ? product.expiryDate.split('T')[0] : '',
      manufactureDate: product?.manufactureDate ? product.manufactureDate.split('T')[0] : '',
      manufacturer: product?.manufacturer || '',
      batchNumber: product?.batchNumber || '',
      requiresPrescription: product?.requiresPrescription || false,
      isActive: product?.isActive ?? true,
      categoryId: product?.categoryId || 0,
      supplierId: product?.supplierId || 0,
    },
    validationSchema,
    enableReinitialize: true,
    onSubmit: (values) => {
      if (isEditing && product) {
        updateMutation.mutate({
          id: product.id,
          data: {
            ...values,
            expiryDate: values.expiryDate || undefined,
            manufactureDate: values.manufactureDate || undefined,
            supplierId: values.supplierId || undefined,
          },
        });
      } else {
        createMutation.mutate({
          ...values,
          expiryDate: values.expiryDate || undefined,
          manufactureDate: values.manufactureDate || undefined,
          supplierId: values.supplierId || undefined,
        });
      }
    },
  });

  const handleClose = () => {
    formik.resetForm();
    onClose();
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {isEditing ? 'Edit Product' : 'Add New Product'}
      </DialogTitle>
      <form onSubmit={formik.handleSubmit}>
        <DialogContent>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                name="name"
                label="Product Name"
                value={formik.values.name}
                onChange={formik.handleChange}
                error={formik.touched.name && Boolean(formik.errors.name)}
                helperText={formik.touched.name && formik.errors.name}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                name="sku"
                label="SKU"
                value={formik.values.sku}
                onChange={formik.handleChange}
                error={formik.touched.sku && Boolean(formik.errors.sku)}
                helperText={formik.touched.sku && formik.errors.sku}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                name="description"
                label="Description"
                multiline
                rows={3}
                value={formik.values.description}
                onChange={formik.handleChange}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                name="barcode"
                label="Barcode"
                value={formik.values.barcode}
                onChange={formik.handleChange}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                name="manufacturer"
                label="Manufacturer"
                value={formik.values.manufacturer}
                onChange={formik.handleChange}
                error={formik.touched.manufacturer && Boolean(formik.errors.manufacturer)}
                helperText={formik.touched.manufacturer && formik.errors.manufacturer}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                name="price"
                label="Price"
                type="number"
                inputProps={{ step: '0.01', min: '0' }}
                value={formik.values.price}
                onChange={formik.handleChange}
                error={formik.touched.price && Boolean(formik.errors.price)}
                helperText={formik.touched.price && formik.errors.price}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                name="costPrice"
                label="Cost Price"
                type="number"
                inputProps={{ step: '0.01', min: '0' }}
                value={formik.values.costPrice}
                onChange={formik.handleChange}
                error={formik.touched.costPrice && Boolean(formik.errors.costPrice)}
                helperText={formik.touched.costPrice && formik.errors.costPrice}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                name="stockQuantity"
                label="Stock Quantity"
                type="number"
                inputProps={{ min: '0' }}
                value={formik.values.stockQuantity}
                onChange={formik.handleChange}
                error={formik.touched.stockQuantity && Boolean(formik.errors.stockQuantity)}
                helperText={formik.touched.stockQuantity && formik.errors.stockQuantity}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                name="minStockLevel"
                label="Min Stock Level"
                type="number"
                inputProps={{ min: '0' }}
                value={formik.values.minStockLevel}
                onChange={formik.handleChange}
                error={formik.touched.minStockLevel && Boolean(formik.errors.minStockLevel)}
                helperText={formik.touched.minStockLevel && formik.errors.minStockLevel}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                name="maxStockLevel"
                label="Max Stock Level"
                type="number"
                inputProps={{ min: '0' }}
                value={formik.values.maxStockLevel}
                onChange={formik.handleChange}
                error={formik.touched.maxStockLevel && Boolean(formik.errors.maxStockLevel)}
                helperText={formik.touched.maxStockLevel && formik.errors.maxStockLevel}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                select
                name="categoryId"
                label="Category"
                value={formik.values.categoryId}
                onChange={formik.handleChange}
                error={formik.touched.categoryId && Boolean(formik.errors.categoryId)}
                helperText={formik.touched.categoryId && formik.errors.categoryId}
                margin="normal"
              >
                <MenuItem value={0}>Select Category</MenuItem>
                {categories.map((category: any) => (
                  <MenuItem key={category.id} value={category.id}>
                    {category.name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                select
                name="supplierId"
                label="Supplier (Optional)"
                value={formik.values.supplierId}
                onChange={formik.handleChange}
                margin="normal"
              >
                <MenuItem value={0}>No Supplier</MenuItem>
                {suppliers.map((supplier: any) => (
                  <MenuItem key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                name="expiryDate"
                label="Expiry Date"
                type="date"
                value={formik.values.expiryDate}
                onChange={formik.handleChange}
                InputLabelProps={{ shrink: true }}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                name="manufactureDate"
                label="Manufacture Date"
                type="date"
                value={formik.values.manufactureDate}
                onChange={formik.handleChange}
                InputLabelProps={{ shrink: true }}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                name="batchNumber"
                label="Batch Number"
                value={formik.values.batchNumber}
                onChange={formik.handleChange}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12}>
              <Box display="flex" gap={2}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formik.values.requiresPrescription}
                      onChange={formik.handleChange}
                      name="requiresPrescription"
                    />
                  }
                  label="Requires Prescription"
                />
                {isEditing && (
                  <FormControlLabel
                    control={
                      <Switch
                        checked={formik.values.isActive}
                        onChange={formik.handleChange}
                        name="isActive"
                      />
                    }
                    label="Active"
                  />
                )}
              </Box>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isLoading}
          >
            {isLoading ? 'Saving...' : isEditing ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default ProductForm;
