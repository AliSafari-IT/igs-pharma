import React, { useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
  TextField,
  Switch,
  FormControlLabel,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Tabs,
  Tab,
  Paper,
} from '@mui/material';
import {
  Settings as SettingsIcon,
  Notifications,
  Security,
  Backup,
  Edit,
  Delete,
  Add,
  Save,
  RestoreFromTrash,
} from '@mui/icons-material';
import { useFormik } from 'formik';
import * as Yup from 'yup';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`settings-tabpanel-${index}`}
      aria-labelledby={`settings-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const Settings: React.FC = () => {
  const [tabValue, setTabValue] = useState(0);
  const [isUserDialogOpen, setIsUserDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [settings, setSettings] = useState({
    // General Settings
    pharmacyName: 'IGS Pharmacy',
    address: '123 Main Street, City, State 12345',
    phone: '(555) 123-4567',
    email: 'info@igspharmacy.com',
    
    // Notification Settings
    lowStockAlerts: true,
    expiryAlerts: true,
    prescriptionReminders: true,
    emailNotifications: true,
    smsNotifications: false,
    
    // Inventory Settings
    autoReorder: true,
    reorderThreshold: 10,
    defaultSupplier: 'MedSupply Co.',
    
    // Security Settings
    sessionTimeout: 30,
    requirePasswordChange: true,
    twoFactorAuth: false,
    
    // Backup Settings
    autoBackup: true,
    backupFrequency: 'daily',
    retentionDays: 30,
  });

  const [users] = useState([
    { id: 1, name: 'John Doe', email: 'john@pharmacy.com', role: 'Admin', active: true },
    { id: 2, name: 'Jane Smith', email: 'jane@pharmacy.com', role: 'Pharmacist', active: true },
    { id: 3, name: 'Mike Johnson', email: 'mike@pharmacy.com', role: 'Technician', active: false },
  ]);

  const userFormik = useFormik({
    initialValues: {
      name: '',
      email: '',
      role: 'Technician',
      password: '',
      confirmPassword: '',
    },
    validationSchema: Yup.object({
      name: Yup.string().required('Name is required'),
      email: Yup.string().email('Invalid email').required('Email is required'),
      role: Yup.string().required('Role is required'),
      password: Yup.string().min(6, 'Password must be at least 6 characters'),
      confirmPassword: Yup.string().oneOf([Yup.ref('password')], 'Passwords must match'),
    }),
    onSubmit: (values) => {
      console.log('User form submitted:', values);
      setIsUserDialogOpen(false);
      userFormik.resetForm();
    },
  });

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleSettingChange = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSaveSettings = () => {
    console.log('Saving settings:', settings);
    // Implementation for saving settings
  };

  const handleBackup = () => {
    console.log('Creating backup...');
    // Implementation for creating backup
  };

  const handleRestore = () => {
    console.log('Restoring from backup...');
    // Implementation for restoring from backup
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Settings
      </Typography>

      <Paper sx={{ width: '100%' }}>
        <Tabs value={tabValue} onChange={handleTabChange} aria-label="settings tabs">
          <Tab label="General" />
          <Tab label="Notifications" />
          <Tab label="Inventory" />
          <Tab label="Users" />
          <Tab label="Security" />
          <Tab label="Backup" />
        </Tabs>

        {/* General Settings */}
        <TabPanel value={tabValue} index={0}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Pharmacy Name"
                value={settings.pharmacyName}
                onChange={(e) => handleSettingChange('pharmacyName', e.target.value)}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Phone Number"
                value={settings.phone}
                onChange={(e) => handleSettingChange('phone', e.target.value)}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Address"
                value={settings.address}
                onChange={(e) => handleSettingChange('address', e.target.value)}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={settings.email}
                onChange={(e) => handleSettingChange('email', e.target.value)}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12}>
              <Button variant="contained" onClick={handleSaveSettings} startIcon={<Save />}>
                Save General Settings
              </Button>
            </Grid>
          </Grid>
        </TabPanel>

        {/* Notification Settings */}
        <TabPanel value={tabValue} index={1}>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                Alert Preferences
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.lowStockAlerts}
                    onChange={(e) => handleSettingChange('lowStockAlerts', e.target.checked)}
                  />
                }
                label="Low Stock Alerts"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.expiryAlerts}
                    onChange={(e) => handleSettingChange('expiryAlerts', e.target.checked)}
                  />
                }
                label="Expiry Date Alerts"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.prescriptionReminders}
                    onChange={(e) => handleSettingChange('prescriptionReminders', e.target.checked)}
                  />
                }
                label="Prescription Reminders"
              />
            </Grid>
            <Grid item xs={12}>
              <Divider sx={{ my: 2 }} />
              <Typography variant="h6" gutterBottom>
                Notification Methods
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.emailNotifications}
                    onChange={(e) => handleSettingChange('emailNotifications', e.target.checked)}
                  />
                }
                label="Email Notifications"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.smsNotifications}
                    onChange={(e) => handleSettingChange('smsNotifications', e.target.checked)}
                  />
                }
                label="SMS Notifications"
              />
            </Grid>
            <Grid item xs={12}>
              <Button variant="contained" onClick={handleSaveSettings} startIcon={<Save />}>
                Save Notification Settings
              </Button>
            </Grid>
          </Grid>
        </TabPanel>

        {/* Inventory Settings */}
        <TabPanel value={tabValue} index={2}>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.autoReorder}
                    onChange={(e) => handleSettingChange('autoReorder', e.target.checked)}
                  />
                }
                label="Enable Auto-Reordering"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Reorder Threshold"
                type="number"
                value={settings.reorderThreshold}
                onChange={(e) => handleSettingChange('reorderThreshold', parseInt(e.target.value))}
                helperText="Minimum stock level before reordering"
                margin="normal"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Default Supplier"
                value={settings.defaultSupplier}
                onChange={(e) => handleSettingChange('defaultSupplier', e.target.value)}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12}>
              <Button variant="contained" onClick={handleSaveSettings} startIcon={<Save />}>
                Save Inventory Settings
              </Button>
            </Grid>
          </Grid>
        </TabPanel>

        {/* User Management */}
        <TabPanel value={tabValue} index={3}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">User Management</Typography>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => setIsUserDialogOpen(true)}
            >
              Add User
            </Button>
          </Box>
          <List>
            {users.map((user) => (
              <ListItem key={user.id} divider>
                <ListItemText
                  primary={user.name}
                  secondary={`${user.email} • ${user.role} • ${user.active ? 'Active' : 'Inactive'}`}
                />
                <ListItemSecondaryAction>
                  <IconButton edge="end" color="primary">
                    <Edit />
                  </IconButton>
                  <IconButton edge="end" color="error">
                    <Delete />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        </TabPanel>

        {/* Security Settings */}
        <TabPanel value={tabValue} index={4}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Session Timeout (minutes)"
                type="number"
                value={settings.sessionTimeout}
                onChange={(e) => handleSettingChange('sessionTimeout', parseInt(e.target.value))}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.requirePasswordChange}
                    onChange={(e) => handleSettingChange('requirePasswordChange', e.target.checked)}
                  />
                }
                label="Require Regular Password Changes"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.twoFactorAuth}
                    onChange={(e) => handleSettingChange('twoFactorAuth', e.target.checked)}
                  />
                }
                label="Enable Two-Factor Authentication"
              />
            </Grid>
            <Grid item xs={12}>
              <Alert severity="info">
                Two-factor authentication adds an extra layer of security to user accounts.
              </Alert>
            </Grid>
            <Grid item xs={12}>
              <Button variant="contained" onClick={handleSaveSettings} startIcon={<Save />}>
                Save Security Settings
              </Button>
            </Grid>
          </Grid>
        </TabPanel>

        {/* Backup Settings */}
        <TabPanel value={tabValue} index={5}>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.autoBackup}
                    onChange={(e) => handleSettingChange('autoBackup', e.target.checked)}
                  />
                }
                label="Enable Automatic Backups"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                select
                label="Backup Frequency"
                value={settings.backupFrequency}
                onChange={(e) => handleSettingChange('backupFrequency', e.target.value)}
                margin="normal"
                SelectProps={{ native: true }}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Retention Period (days)"
                type="number"
                value={settings.retentionDays}
                onChange={(e) => handleSettingChange('retentionDays', parseInt(e.target.value))}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12}>
              <Box display="flex" gap={2}>
                <Button variant="contained" onClick={handleBackup} startIcon={<Backup />}>
                  Create Backup Now
                </Button>
                <Button variant="outlined" onClick={handleRestore} startIcon={<RestoreFromTrash />}>
                  Restore from Backup
                </Button>
              </Box>
            </Grid>
            <Grid item xs={12}>
              <Alert severity="warning">
                Regular backups are essential for data protection. Ensure backups are stored securely.
              </Alert>
            </Grid>
          </Grid>
        </TabPanel>
      </Paper>

      {/* User Form Dialog */}
      <Dialog open={isUserDialogOpen} onClose={() => setIsUserDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add New User</DialogTitle>
        <form onSubmit={userFormik.handleSubmit}>
          <DialogContent>
            <TextField
              fullWidth
              name="name"
              label="Full Name"
              value={userFormik.values.name}
              onChange={userFormik.handleChange}
              error={userFormik.touched.name && Boolean(userFormik.errors.name)}
              helperText={userFormik.touched.name && userFormik.errors.name}
              margin="normal"
            />
            <TextField
              fullWidth
              name="email"
              label="Email"
              type="email"
              value={userFormik.values.email}
              onChange={userFormik.handleChange}
              error={userFormik.touched.email && Boolean(userFormik.errors.email)}
              helperText={userFormik.touched.email && userFormik.errors.email}
              margin="normal"
            />
            <TextField
              fullWidth
              select
              name="role"
              label="Role"
              value={userFormik.values.role}
              onChange={userFormik.handleChange}
              margin="normal"
              SelectProps={{ native: true }}
            >
              <option value="Admin">Admin</option>
              <option value="Pharmacist">Pharmacist</option>
              <option value="Technician">Technician</option>
            </TextField>
            <TextField
              fullWidth
              name="password"
              label="Password"
              type="password"
              value={userFormik.values.password}
              onChange={userFormik.handleChange}
              error={userFormik.touched.password && Boolean(userFormik.errors.password)}
              helperText={userFormik.touched.password && userFormik.errors.password}
              margin="normal"
            />
            <TextField
              fullWidth
              name="confirmPassword"
              label="Confirm Password"
              type="password"
              value={userFormik.values.confirmPassword}
              onChange={userFormik.handleChange}
              error={userFormik.touched.confirmPassword && Boolean(userFormik.errors.confirmPassword)}
              helperText={userFormik.touched.confirmPassword && userFormik.errors.confirmPassword}
              margin="normal"
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setIsUserDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained">
              Add User
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
};

export default Settings;
