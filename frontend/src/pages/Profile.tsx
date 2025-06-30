import React from 'react';
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
  TextField
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

const Profile: React.FC = () => {
  const { user } = useAuth();
  const [isEditing, setIsEditing] = React.useState(false);
  
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
                      label="First Name" 
                      defaultValue={user.firstName}
                      fullWidth
                      size="small"
                    />
                    <TextField 
                      label="Last Name" 
                      defaultValue={user.lastName}
                      fullWidth
                      size="small"
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
                    label="Email" 
                    defaultValue={user.email}
                    fullWidth
                    size="small"
                    type="email"
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
                    label="Phone Number" 
                    defaultValue={user.phoneNumber || ''}
                    fullWidth
                    size="small"
                    type="tel"
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
                    label="Department" 
                    defaultValue={user.department || ''}
                    fullWidth
                    size="small"
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
                  // TODO: Implement save functionality
                  onClick={() => {
                    // Save changes
                    setIsEditing(false);
                  }}
                >
                  Save Changes
                </Button>
              </Box>
            )}
          </Grid>
        </Grid>
      </Paper>
    </Container>
  );
};

export default Profile;
