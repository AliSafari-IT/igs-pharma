import React, { useState, useEffect } from 'react';
import { 
  Container, 
  Typography, 
  Paper, 
  Avatar, 
  Box, 
  Grid,
  Button,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  TextField,
  Snackbar,
  Alert,
  CircularProgress
} from '@mui/material';
import { 
  Person as PersonIcon, 
  Email as EmailIcon, 
  Phone as PhoneIcon, 
  Business as DepartmentIcon,
  Badge as EmployeeIdIcon,
  Edit as EditIcon
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';

interface ProfileFormData {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  department: string;
}

const Profile: React.FC = () => {
  const { user, updateUser } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<ProfileFormData>({
    firstName: '',
    lastName: '',
    email: '',
    phoneNumber: '',
    department: ''
  });
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success' as 'success' | 'error'
  });

  // Initialize form data when user is loaded
  useEffect(() => {
    if (user) {
      setFormData({
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || '',
        phoneNumber: user.phoneNumber || '',
        department: user.department || ''
      });
    }
  }, [user]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/users/${user.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        throw new Error('Failed to update profile');
      }

      const updatedUser = await response.json();
      updateUser(updatedUser);
      
      setSnackbar({
        open: true,
        message: 'Profile updated successfully!',
        severity: 'success'
      });
      
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating profile:', error);
      setSnackbar({
        open: true,
        message: 'Failed to update profile. Please try again.',
        severity: 'error'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCloseSnackbar = () => {
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  if (!user) {
    return <div>Loading...</div>;
  }

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
          <Typography variant="h4" component="h1">
            My Profile
          </Typography>
          <Button 
            variant="contained" 
            startIcon={<EditIcon />}
            onClick={() => setIsEditing(!isEditing)}
          >
            {isEditing ? 'Cancel' : 'Edit Profile'}
          </Button>
        </Box>

        <Grid container spacing={4}>
          <Grid item xs={12} md={4}>
            <Box display="flex" flexDirection="column" alignItems="center">
              <Avatar 
                sx={{ 
                  width: 150, 
                  height: 150, 
                  fontSize: 60,
                  mb: 2 
                }}
              >
                {user.firstName?.[0]}{user.lastName?.[0]}
              </Avatar>
              <Typography variant="h6">
                {user.firstName} {user.lastName}
              </Typography>
              <Typography color="textSecondary">
                {user.role}
              </Typography>
            </Box>
          </Grid>
          
          <Grid item xs={12} md={8}>
            <List>
              <ListItem>
                <ListItemIcon>
                  <PersonIcon />
                </ListItemIcon>
                {isEditing ? (
                  <Box width="100%" display="flex" gap={2}>
                    <TextField 
                      name="firstName"
                      label="First Name" 
                      value={formData.firstName}
                      onChange={handleInputChange}
                      fullWidth
                      size="small"
                      disabled={isLoading}
                    />
                    <TextField 
                      name="lastName"
                      label="Last Name" 
                      value={formData.lastName}
                      onChange={handleInputChange}
                      fullWidth
                      size="small"
                      disabled={isLoading}
                    />
                  </Box>
                ) : (
                  <ListItemText 
                    primary="Full Name" 
                    secondary={`${user.firstName} ${user.lastName}`} 
                  />
                )}
              </ListItem>
              
              <Divider component="li" />
              
              <ListItem>
                <ListItemIcon>
                  <EmailIcon />
                </ListItemIcon>
                {isEditing ? (
                  <TextField 
                    name="email"
                    label="Email" 
                    value={formData.email}
                    onChange={handleInputChange}
                    fullWidth
                    size="small"
                    type="email"
                    disabled={isLoading}
                  />
                ) : (
                  <ListItemText primary="Email" secondary={user.email} />
                )}
              </ListItem>
              
              <Divider component="li" />
              
              <ListItem>
                <ListItemIcon>
                  <PhoneIcon />
                </ListItemIcon>
                {isEditing ? (
                  <TextField 
                    name="phoneNumber"
                    label="Phone Number" 
                    value={formData.phoneNumber}
                    onChange={handleInputChange}
                    fullWidth
                    size="small"
                    type="tel"
                    disabled={isLoading}
                  />
                ) : (
                  <ListItemText 
                    primary="Phone Number" 
                    secondary={user.phoneNumber || 'Not provided'} 
                  />
                )}
              </ListItem>
              
              <Divider component="li" />
              
              <ListItem>
                <ListItemIcon>
                  <DepartmentIcon />
                </ListItemIcon>
                {isEditing ? (
                  <TextField 
                    name="department"
                    label="Department" 
                    value={formData.department}
                    onChange={handleInputChange}
                    fullWidth
                    size="small"
                    disabled={isLoading}
                  />
                ) : (
                  <ListItemText 
                    primary="Department" 
                    secondary={user.department || 'Not specified'} 
                  />
                )}
              </ListItem>
              
              <Divider component="li" />
              
              <ListItem>
                <ListItemIcon>
                  <EmployeeIdIcon />
                </ListItemIcon>
                <ListItemText 
                  primary="Employee ID" 
                  secondary={user.employeeId || 'Not assigned'} 
                />
              </ListItem>
            </List>
            
            {isEditing && (
              <Box display="flex" justifyContent="flex-end" mt={3} gap={2}>
                <Button 
                  variant="outlined" 
                  onClick={() => setIsEditing(false)}
                >
                  Cancel
                </Button>
                <Button 
                  variant="contained" 
                  color="primary"
                  onClick={handleSubmit}
                  disabled={isLoading}
                  startIcon={isLoading ? <CircularProgress size={20} color="inherit" /> : null}
                >
                  {isLoading ? 'Saving...' : 'Save Changes'}
                </Button>
              </Box>
            )}
          </Grid>
        </Grid>
      </Paper>
      
      <Snackbar 
        open={snackbar.open} 
        autoHideDuration={6000} 
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert 
          onClose={handleCloseSnackbar} 
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default Profile;
