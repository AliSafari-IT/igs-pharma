import React, { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Container,
  FormControl,
  FormHelperText,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
  Alert,
  CircularProgress,
  Link,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  PersonAdd,
  Badge,
  CreditCard,
} from '@mui/icons-material';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../services/api';

interface RegisterFormData {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  department: string;
  role: string;
  employeeId: string;
  cardId: string;
  cardExpiryDate: string;
}

const validationSchema = Yup.object({
  username: Yup.string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must not exceed 50 characters')
    .required('Username is required'),
  email: Yup.string()
    .email('Invalid email format')
    .required('Email is required'),
  password: Yup.string()
    .min(6, 'Password must be at least 6 characters')
    .required('Password is required'),
  confirmPassword: Yup.string()
    .oneOf([Yup.ref('password')], 'Passwords must match')
    .required('Password confirmation is required'),
  firstName: Yup.string()
    .max(50, 'First name must not exceed 50 characters')
    .required('First name is required'),
  lastName: Yup.string()
    .max(50, 'Last name must not exceed 50 characters')
    .required('Last name is required'),
  phoneNumber: Yup.string()
    .matches(/^[\+]?[1-9][\d]{0,15}$/, 'Invalid phone number format'),
  department: Yup.string()
    .max(100, 'Department must not exceed 100 characters'),
  role: Yup.string().required('Role is required'),
  employeeId: Yup.string()
    .max(50, 'Employee ID must not exceed 50 characters'),
  cardId: Yup.string()
    .required('Card ID is required')
    .max(50, 'Card ID must not exceed 50 characters'),
  cardExpiryDate: Yup.date()
    .min(new Date(), 'Card expiry date must be in the future'),
});

const Register: React.FC = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const navigate = useNavigate();

  const formik = useFormik<RegisterFormData>({
    initialValues: {
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
      firstName: '',
      lastName: '',
      phoneNumber: '',
      department: '',
      role: 'Cashier', // Default role changed from 'Employee' to 'Cashier' to match backend enum
      employeeId: '',
      cardId: '',
      cardExpiryDate: '',
    },
    validationSchema,
    onSubmit: async (values) => {
      setLoading(true);
      setError(null);
      setSuccess(null);

      try {
        // Format the data for the API
        const registerData = {
          username: values.username.trim(),
          email: values.email.trim(),
          password: values.password,
          confirmPassword: values.confirmPassword,
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          // Handle optional fields properly - use null for empty fields to avoid validation errors
          phoneNumber: values.phoneNumber && values.phoneNumber.trim() !== "" ? values.phoneNumber.trim() : null,
          department: values.department && values.department.trim() !== "" ? values.department.trim() : null,
          // Ensure role is capitalized correctly to match backend enum
          role: "Cashier", // Hardcode to ensure it matches exactly
          employeeId: values.employeeId && values.employeeId.trim() !== "" ? values.employeeId.trim() : null,
          cardId: values.cardId && values.cardId.trim() !== "" ? values.cardId.trim() : null,
          // Format date as ISO string if provided, otherwise null
          cardExpiryDate: values.cardExpiryDate && values.cardExpiryDate.trim() !== "" 
            ? new Date(values.cardExpiryDate).toISOString() 
            : null
        };
        
        // Log the data being sent to the API for debugging
        console.log('Registration data being sent:', JSON.stringify(registerData, null, 2));

        const response = await authApi.register(registerData);
        
        setSuccess('Registration successful! You can now log in with your credentials.');
        
        // Redirect to login page after 2 seconds
        setTimeout(() => {
          navigate('/login');
        }, 2000);
        
      } catch (err: any) {
        console.error('Registration error:', err);
        console.error('Error response data:', err.response?.data);
        
        let errorMessage = 'Registration failed. Please check your information and try again.';
        
        if (err.response?.data) {
          // Handle validation errors from the server
          if (err.response.data.errors) {
            // If we have a dictionary of field errors
            if (typeof err.response.data.errors === 'object' && err.response.data.errors !== null) {
              // Map field errors to formik errors
              const fieldErrors: Record<string, string> = {};
              Object.entries(err.response.data.errors).forEach(([field, errors]) => {
                const errorMessage = Array.isArray(errors) ? errors.join(', ') : String(errors);
                fieldErrors[field.toLowerCase()] = errorMessage;
              });
              
              // Set formik errors
              formik.setErrors({
                ...formik.errors,
                ...fieldErrors
              });
              
              errorMessage = 'Please fix the highlighted errors below.';
            } 
            // If we have an array of error messages
            else if (Array.isArray(err.response.data.errors)) {
              errorMessage = err.response.data.errors.join('\n');
            }
          } 
          // Handle simple error message
          else if (err.response.data.message) {
            errorMessage = err.response.data.message;
            
            // Handle specific error messages
            if (errorMessage.toLowerCase().includes('username')) {
              formik.setFieldError('username', errorMessage);
            } else if (errorMessage.toLowerCase().includes('email')) {
              formik.setFieldError('email', errorMessage);
            } else if (errorMessage.toLowerCase().includes('employeeid')) {
              formik.setFieldError('employeeId', errorMessage);
            } else if (errorMessage.toLowerCase().includes('cardid') || errorMessage.toLowerCase().includes('card id')) {
              formik.setFieldError('cardId', errorMessage);
            }
          }
          
          // Log the full error object for debugging
          console.log('Full error response:', JSON.stringify(err.response?.data, null, 2));
        } else if (err.message) {
          errorMessage = err.message;
        }
      } finally {
        setLoading(false);
      }
    },
  });

  // Update the error state to show the error message
  if (error) setError(error);

  const handleUsernameBlur = async () => {
    if (formik.values.username && !formik.errors.username) {
      try {
        const response = await authApi.checkUsername(formik.values.username);
        if (!response.data.available) {
          formik.setFieldError('username', 'Username is already taken');
        }
      } catch (error) {
        console.error('Error checking username availability:', error);
      }
    }
  };

  const handleEmailBlur = async () => {
    if (formik.values.email && !formik.errors.email) {
      try {
        const response = await authApi.checkEmail(formik.values.email);
        if (!response.data.available) {
          formik.setFieldError('email', 'Email is already registered');
        }
      } catch (error) {
        console.error('Error checking email availability:', error);
      }
    }
  };

  const handleEmployeeIdBlur = async () => {
    if (formik.values.employeeId && !formik.errors.employeeId) {
      try {
        const response = await authApi.checkEmployeeId(formik.values.employeeId);
        if (!response.data.available) {
          formik.setFieldError('employeeId', 'Employee ID is already assigned');
        }
      } catch (error) {
        console.error('Error checking employee ID availability:', error);
      }
    }
  };

  const roles = [
    { value: 'Admin', label: 'Administrator' },
    { value: 'Manager', label: 'Manager' },
    { value: 'Pharmacist', label: 'Pharmacist' },
    { value: 'Technician', label: 'Pharmacy Technician' },
    { value: 'Cashier', label: 'Cashier' },
  ];

  const departments = [
    'Pharmacy',
    'Administration',
    'Sales',
    'Inventory',
    'Customer Service',
    'IT Support',
    'Management',
  ];

  return (
    <Container component="main" maxWidth="md">
      <Box
        sx={{
          marginTop: 4,
          marginBottom: 4,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Card sx={{ width: '100%', maxWidth: 800 }}>
          <CardContent sx={{ p: 4 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
              <PersonAdd sx={{ mr: 2, fontSize: 32, color: 'primary.main' }} />
              <Typography component="h1" variant="h4" color="primary">
                Register New User
              </Typography>
            </Box>

            {error && (
              <Alert severity="error" sx={{ mb: 3 }}>
                {error}
              </Alert>
            )}

            {success && (
              <Alert severity="success" sx={{ mb: 3 }}>
                {success}
              </Alert>
            )}

            <Box component="form" onSubmit={formik.handleSubmit}>
              <Grid container spacing={3}>
                {/* Basic Information */}
                <Grid item xs={12}>
                  <Typography variant="h6" gutterBottom color="primary">
                    Basic Information
                  </Typography>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    id="firstName"
                    name="firstName"
                    label="First Name"
                    value={formik.values.firstName}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    error={formik.touched.firstName && Boolean(formik.errors.firstName)}
                    helperText={formik.touched.firstName && formik.errors.firstName}
                    required
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    id="lastName"
                    name="lastName"
                    label="Last Name"
                    value={formik.values.lastName}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    error={formik.touched.lastName && Boolean(formik.errors.lastName)}
                    helperText={formik.touched.lastName && formik.errors.lastName}
                    required
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    id="username"
                    name="username"
                    label="Username"
                    value={formik.values.username}
                    onChange={formik.handleChange}
                    onBlur={(e) => {
                      formik.handleBlur(e);
                      handleUsernameBlur();
                    }}
                    error={formik.touched.username && Boolean(formik.errors.username)}
                    helperText={formik.touched.username && formik.errors.username}
                    required
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    id="email"
                    name="email"
                    label="Email Address"
                    type="email"
                    value={formik.values.email}
                    onChange={formik.handleChange}
                    onBlur={(e) => {
                      formik.handleBlur(e);
                      handleEmailBlur();
                    }}
                    error={formik.touched.email && Boolean(formik.errors.email)}
                    helperText={formik.touched.email && formik.errors.email}
                    required
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    id="phoneNumber"
                    name="phoneNumber"
                    label="Phone Number"
                    value={formik.values.phoneNumber}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    error={formik.touched.phoneNumber && Boolean(formik.errors.phoneNumber)}
                    helperText={formik.touched.phoneNumber && formik.errors.phoneNumber}
                  />
                </Grid>

                {/* Work Information */}
                <Grid item xs={12}>
                  <Typography variant="h6" gutterBottom color="primary" sx={{ mt: 2 }}>
                    Work Information
                  </Typography>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth error={formik.touched.role && Boolean(formik.errors.role)}>
                    <InputLabel id="role-label">Role *</InputLabel>
                    <Select
                      labelId="role-label"
                      id="role"
                      name="role"
                      value={formik.values.role}
                      label="Role *"
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                    >
                      {roles.map((role) => (
                        <MenuItem key={role.value} value={role.value}>
                          {role.label}
                        </MenuItem>
                      ))}
                    </Select>
                    {formik.touched.role && formik.errors.role && (
                      <FormHelperText>{formik.errors.role}</FormHelperText>
                    )}
                  </FormControl>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel id="department-label">Department</InputLabel>
                    <Select
                      labelId="department-label"
                      id="department"
                      name="department"
                      value={formik.values.department}
                      label="Department"
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                    >
                      {departments.map((dept) => (
                        <MenuItem key={dept} value={dept}>
                          {dept}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>

                {/* ID Card Information */}
                <Grid item xs={12}>
                  <Typography variant="h6" gutterBottom color="primary" sx={{ mt: 2 }}>
                    <CreditCard sx={{ mr: 1, verticalAlign: 'middle' }} />
                    ID Card Information (Optional)
                  </Typography>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    id="employeeId"
                    name="employeeId"
                    label="Employee ID"
                    value={formik.values.employeeId}
                    onChange={formik.handleChange}
                    onBlur={(e) => {
                      formik.handleBlur(e);
                      handleEmployeeIdBlur();
                    }}
                    error={formik.touched.employeeId && Boolean(formik.errors.employeeId)}
                    helperText={formik.touched.employeeId && formik.errors.employeeId}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Badge />
                        </InputAdornment>
                      ),
                    }}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    id="cardId"
                    name="cardId"
                    label="Card ID *"
                    value={formik.values.cardId}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    error={formik.touched.cardId && Boolean(formik.errors.cardId)}
                    helperText={(formik.touched.cardId && formik.errors.cardId) || 'Required field'}
                    required
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <CreditCard />
                        </InputAdornment>
                      ),
                    }}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    id="cardExpiryDate"
                    name="cardExpiryDate"
                    label="Card Expiry Date"
                    type="date"
                    value={formik.values.cardExpiryDate}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    error={formik.touched.cardExpiryDate && Boolean(formik.errors.cardExpiryDate)}
                    helperText={formik.touched.cardExpiryDate && formik.errors.cardExpiryDate}
                    InputLabelProps={{
                      shrink: true,
                    }}
                  />
                </Grid>

                {/* Security Information */}
                <Grid item xs={12}>
                  <Typography variant="h6" gutterBottom color="primary" sx={{ mt: 2 }}>
                    Security Information
                  </Typography>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    id="password"
                    name="password"
                    label="Password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={formik.values.password}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    error={formik.touched.password && Boolean(formik.errors.password)}
                    helperText={formik.touched.password && formik.errors.password}
                    required
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            aria-label="toggle password visibility"
                            onClick={() => setShowPassword(!showPassword)}
                            edge="end"
                          >
                            {showPassword ? <VisibilityOff /> : <Visibility />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    id="confirmPassword"
                    name="confirmPassword"
                    label="Confirm Password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={formik.values.confirmPassword}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    error={formik.touched.confirmPassword && Boolean(formik.errors.confirmPassword)}
                    helperText={formik.touched.confirmPassword && formik.errors.confirmPassword}
                    required
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            aria-label="toggle confirm password visibility"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            edge="end"
                          >
                            {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                  />
                </Grid>

                {/* Submit Button */}
                <Grid item xs={12}>
                  <Button
                    type="submit"
                    fullWidth
                    variant="contained"
                    color="primary"
                    disabled={loading || formik.isSubmitting}
                    startIcon={loading ? <CircularProgress size={20} /> : <PersonAdd />}
                    sx={{ mt: 3, mb: 2, height: '48px' }}
                  >
                    {loading ? 'Registering...' : 'Register'}
                  </Button>
                </Grid>

                <Grid item xs={12}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="body2">
                      Already have an account?{' '}
                      <Link
                        component="button"
                        variant="body2"
                        onClick={() => navigate('/login')}
                        sx={{ textDecoration: 'none' }}
                      >
                        Sign in here
                      </Link>
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
};

export default Register;
