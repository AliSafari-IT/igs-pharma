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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Chip,
  Autocomplete,
  MenuItem,
} from '@mui/material';
import {
  Add,
  Edit,
  Delete,
  Visibility,
  LocalPharmacy,
  Person,
  Assignment,
  CheckCircle,
  Schedule,
  Warning,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import { prescriptionApi, patientApi, productApi } from '../services/api';

const validationSchema = Yup.object({
  patientId: Yup.number().required('Patient is required'),
  doctorName: Yup.string().required('Doctor name is required'),
  prescriptionDate: Yup.date().required('Prescription date is required'),
  items: Yup.array().min(1, 'At least one medication is required'),
});

const Prescriptions: React.FC = () => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedPrescription, setSelectedPrescription] = useState<any>(null);
  const [prescriptionItems, setPrescriptionItems] = useState<any[]>([]);
  const queryClient = useQueryClient();

  const { data: prescriptions = [], isLoading } = useQuery({
    queryKey: ['prescriptions'],
    queryFn: () => prescriptionApi.getAll().then(res => res.data),
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => patientApi.getAll().then(res => res.data),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => productApi.getAll().then(res => res.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => prescriptionApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prescriptions'] });
      handleCloseDialog();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => prescriptionApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prescriptions'] });
      handleCloseDialog();
    },
  });

  const formik = useFormik({
    initialValues: {
      patientId: 0,
      doctorName: '',
      doctorLicense: '',
      prescriptionDate: new Date().toISOString().split('T')[0],
      notes: '',
      refillsAllowed: 0,
      status: 'Pending',
    },
    validationSchema,
    onSubmit: (values) => {
      const prescriptionData = {
        ...values,
        items: prescriptionItems.filter(item => item.productId > 0),
      };

      if (selectedPrescription) {
        updateMutation.mutate({ id: selectedPrescription.id, data: prescriptionData });
      } else {
        createMutation.mutate(prescriptionData);
      }
    },
  });

  const handleEdit = (prescription: any) => {
    setSelectedPrescription(prescription);
    formik.setValues({
      patientId: prescription.patientId || 0,
      doctorName: prescription.doctorName || '',
      doctorLicense: prescription.doctorLicense || '',
      prescriptionDate: prescription.prescriptionDate ? prescription.prescriptionDate.split('T')[0] : '',
      notes: prescription.notes || '',
      refillsAllowed: prescription.refillsAllowed || 0,
      status: prescription.status || 'Pending',
    });
    setPrescriptionItems(prescription.items || []);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setSelectedPrescription(null);
    formik.resetForm();
    setPrescriptionItems([]);
  };

  const addPrescriptionItem = () => {
    setPrescriptionItems([...prescriptionItems, {
      productId: 0,
      dosage: '',
      frequency: '',
      duration: '',
      instructions: '',
    }]);
  };

  const removePrescriptionItem = (index: number) => {
    setPrescriptionItems(prescriptionItems.filter((_, i) => i !== index));
  };

  const updatePrescriptionItem = (index: number, field: string, value: any) => {
    const updatedItems = [...prescriptionItems];
    updatedItems[index] = { ...updatedItems[index], [field]: value };
    setPrescriptionItems(updatedItems);
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'filled': return 'success';
      case 'pending': return 'warning';
      case 'cancelled': return 'error';
      case 'expired': return 'default';
      default: return 'info';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'filled': return <CheckCircle />;
      case 'pending': return <Schedule />;
      case 'cancelled': return <Warning />;
      case 'expired': return <Warning />;
      default: return <Assignment />;
    }
  };

  // Calculate statistics
  const pendingPrescriptions = prescriptions.filter((p: any) => p.status === 'Pending').length;
  const filledPrescriptions = prescriptions.filter((p: any) => p.status === 'Filled').length;
  const expiredPrescriptions = prescriptions.filter((p: any) => p.status === 'Expired').length;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Prescription Management</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setIsDialogOpen(true)}
        >
          New Prescription
        </Button>
      </Box>

      {/* Prescription Statistics */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center">
                <LocalPharmacy color="primary" sx={{ mr: 2 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Total Prescriptions
                  </Typography>
                  <Typography variant="h5">
                    {prescriptions.length}
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
                <Schedule color="warning" sx={{ mr: 2 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Pending
                  </Typography>
                  <Typography variant="h5">
                    {pendingPrescriptions}
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
                <CheckCircle color="success" sx={{ mr: 2 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Filled
                  </Typography>
                  <Typography variant="h5">
                    {filledPrescriptions}
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
                <Warning color="error" sx={{ mr: 2 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Expired
                  </Typography>
                  <Typography variant="h5">
                    {expiredPrescriptions}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Prescriptions Table */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Prescription Records
          </Typography>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Prescription ID</TableCell>
                  <TableCell>Patient</TableCell>
                  <TableCell>Doctor</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Medications</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {prescriptions.map((prescription: any) => (
                  <TableRow key={prescription.id}>
                    <TableCell>#{prescription.id}</TableCell>
                    <TableCell>
                      <Box display="flex" alignItems="center">
                        <Person sx={{ mr: 1, color: 'text.secondary' }} />
                        {prescription.patientName}
                      </Box>
                    </TableCell>
                    <TableCell>{prescription.doctorName}</TableCell>
                    <TableCell>
                      {new Date(prescription.prescriptionDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {prescription.items?.length || 0} medication(s)
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={prescription.status}
                        color={getStatusColor(prescription.status) as any}
                        size="small"
                        icon={getStatusIcon(prescription.status)}
                      />
                    </TableCell>
                    <TableCell align="center">
                      <IconButton size="small" color="primary">
                        <Visibility />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="secondary"
                        onClick={() => handleEdit(prescription)}
                      >
                        <Edit />
                      </IconButton>
                      <IconButton size="small" color="error">
                        <Delete />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Prescription Form Dialog */}
      <Dialog open={isDialogOpen} onClose={handleCloseDialog} maxWidth="lg" fullWidth>
        <DialogTitle>
          {selectedPrescription ? 'Edit Prescription' : 'New Prescription'}
        </DialogTitle>
        <form onSubmit={formik.handleSubmit}>
          <DialogContent>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Autocomplete
                  options={patients}
                  getOptionLabel={(option) => `${option.firstName} ${option.lastName} - ${option.phoneNumber}`}
                  value={patients.find((p: any) => p.id === formik.values.patientId) || null}
                  onChange={(_, newValue) => formik.setFieldValue('patientId', newValue?.id || 0)}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Patient"
                      error={formik.touched.patientId && Boolean(formik.errors.patientId)}
                      helperText={formik.touched.patientId && formik.errors.patientId}
                      margin="normal"
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="doctorName"
                  label="Doctor Name"
                  value={formik.values.doctorName}
                  onChange={formik.handleChange}
                  error={formik.touched.doctorName && Boolean(formik.errors.doctorName)}
                  helperText={formik.touched.doctorName && formik.errors.doctorName}
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="doctorLicense"
                  label="Doctor License Number"
                  value={formik.values.doctorLicense}
                  onChange={formik.handleChange}
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="prescriptionDate"
                  label="Prescription Date"
                  type="date"
                  value={formik.values.prescriptionDate}
                  onChange={formik.handleChange}
                  InputLabelProps={{ shrink: true }}
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="refillsAllowed"
                  label="Refills Allowed"
                  type="number"
                  value={formik.values.refillsAllowed}
                  onChange={formik.handleChange}
                  inputProps={{ min: 0, max: 12 }}
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  select
                  name="status"
                  label="Status"
                  value={formik.values.status}
                  onChange={formik.handleChange}
                  margin="normal"
                >
                  <MenuItem value="Pending">Pending</MenuItem>
                  <MenuItem value="Filled">Filled</MenuItem>
                  <MenuItem value="Cancelled">Cancelled</MenuItem>
                  <MenuItem value="Expired">Expired</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  name="notes"
                  label="Notes"
                  multiline
                  rows={3}
                  value={formik.values.notes}
                  onChange={formik.handleChange}
                  margin="normal"
                />
              </Grid>

              {/* Prescription Items */}
              <Grid item xs={12}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                  <Typography variant="h6">Medications</Typography>
                  <Button startIcon={<Add />} onClick={addPrescriptionItem}>
                    Add Medication
                  </Button>
                </Box>

                {prescriptionItems.map((item, index) => (
                  <Card key={index} sx={{ mb: 2, p: 2 }}>
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={4}>
                        <Autocomplete
                          options={products.filter(p => p.requiresPrescription)}
                          getOptionLabel={(option) => `${option.name} - ${option.sku}`}
                          value={products.find(p => p.id === item.productId) || null}
                          onChange={(_, newValue) => updatePrescriptionItem(index, 'productId', newValue?.id || 0)}
                          renderInput={(params) => (
                            <TextField {...params} label="Medication" size="small" />
                          )}
                        />
                      </Grid>
                      <Grid item xs={12} md={2}>
                        <TextField
                          fullWidth
                          label="Dosage"
                          size="small"
                          value={item.dosage}
                          onChange={(e) => updatePrescriptionItem(index, 'dosage', e.target.value)}
                          placeholder="e.g., 500mg"
                        />
                      </Grid>
                      <Grid item xs={12} md={2}>
                        <TextField
                          fullWidth
                          label="Frequency"
                          size="small"
                          value={item.frequency}
                          onChange={(e) => updatePrescriptionItem(index, 'frequency', e.target.value)}
                          placeholder="e.g., 2x daily"
                        />
                      </Grid>
                      <Grid item xs={12} md={2}>
                        <TextField
                          fullWidth
                          label="Duration"
                          size="small"
                          value={item.duration}
                          onChange={(e) => updatePrescriptionItem(index, 'duration', e.target.value)}
                          placeholder="e.g., 7 days"
                        />
                      </Grid>
                      <Grid item xs={12} md={1}>
                        <IconButton onClick={() => removePrescriptionItem(index)} color="error">
                          <Delete />
                        </IconButton>
                      </Grid>
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Instructions"
                          size="small"
                          value={item.instructions}
                          onChange={(e) => updatePrescriptionItem(index, 'instructions', e.target.value)}
                          placeholder="Special instructions for the patient"
                        />
                      </Grid>
                    </Grid>
                  </Card>
                ))}
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDialog}>Cancel</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending
                ? 'Saving...'
                : selectedPrescription
                ? 'Update'
                : 'Create'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
};

export default Prescriptions;
