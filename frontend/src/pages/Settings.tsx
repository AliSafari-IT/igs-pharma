import React, { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
  Button,
  TextField,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Alert,
  Switch,
  FormControlLabel,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
} from '@mui/material';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import { settingsApi, authApi } from '../services/api';
import { Add, Backup, Delete, Edit, RestoreFromTrash, Save } from "@mui/icons-material";

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
    pharmacyName: "IGS Pharmacy",
    address: "123 Main Street, City, State 12345",
    phone: "(555) 123-4567",
    email: "info@igspharmacy.com",

    // Notification Settings
    lowStockAlerts: true,
    expiryAlerts: true,
    prescriptionReminders: true,
    emailNotifications: true,
    smsNotifications: false,

    // Inventory Settings
    autoReorder: true,
    reorderThreshold: 10,
    defaultSupplier: "MedSupply Co.",

    // Security Settings
    sessionTimeout: 30,
    requirePasswordChange: true,
    twoFactorAuth: false,

    // Backup Settings
    autoBackup: true,
    backupFrequency: "daily",
    retentionDays: 30,
  });

  const [users, setUsers] = useState<any[]>([
    { id: 1, name: 'John Doe', email: 'john@example.com', role: 'Admin', active: true },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com', role: 'Pharmacist', active: true },
    { id: 3, name: 'Bob Johnson', email: 'bob@example.com', role: 'Technician', active: false },
  ]);

  // Add user mutation
  const addUserMutation = useMutation({
    mutationFn: (userData: any) => {
      console.log('Sending user registration data:', JSON.stringify(userData, null, 2));
      return authApi.register(userData);
    },
    onSuccess: (response) => {
      console.log('Registration success response:', response);
      // Add the new user to the list
      const userData = response.data;
      const newUser = {
        id: userData.id,
        name: `${userData.firstName} ${userData.lastName}`,
        email: userData.email,
        role: userData.role,
        active: userData.isActive,
      };
      setUsers((prevUsers) => [...prevUsers, newUser]);
      
      // Show success message
      setSuccessMessage("User added successfully");
      setTimeout(() => setSuccessMessage(""), 3000);
      
      // Close dialog and reset form
      setIsUserDialogOpen(false);
      userFormik.resetForm();
    },
    onError: (error: any) => {
      console.error("Registration error:", error);
      console.error("Response data:", error?.response?.data);
      console.error("Request payload:", error?.config?.data);
      
      // Extract detailed error information
      let errorDetails = '';
      if (error?.response?.data?.errors) {
        if (typeof error.response.data.errors === 'object') {
          // Handle case where errors is an object with field names as keys
          Object.entries(error.response.data.errors).forEach(([field, messages]) => {
            // Format the field name for display
            const formattedField = field.charAt(0).toUpperCase() + field.slice(1); // Capitalize field name
            const messageStr = Array.isArray(messages) ? (messages as string[]).join(', ') : String(messages);
            errorDetails += `${formattedField}: ${messageStr}\n`;
            
            // Set field errors in formik if they exist
            if (userFormik.setFieldError && userFormik.setFieldTouched) {
              // Match our PascalCase field names
              userFormik.setFieldTouched(field, true, false);
              userFormik.setFieldError(
                field, 
                messageStr
              );
            }
          });
        } else if (Array.isArray(error.response.data.errors)) {
          // Handle case where errors is an array of strings
          errorDetails = error.response.data.errors.join(', ');
        }
      } else if (error?.response?.data?.title || error?.response?.data?.detail) {
        // Handle ASP.NET Core ProblemDetails format
        errorDetails = error.response.data.title || error.response.data.detail;
      }
      
      // Show error message
      const errorMessage = error?.response?.data?.message || 
                          errorDetails || 
                          error?.message || 
                          "Unknown error";
      setErrorMessage(`Error adding user: ${errorMessage}`);
      setTimeout(() => setErrorMessage(""), 8000); // Give more time to read detailed errors
    },
  });

  const userFormik = useFormik({
    initialValues: {
      Username: "",
      Email: "",
      Password: "",
      ConfirmPassword: "",
      FirstName: "",
      LastName: "",
      PhoneNumber: "",
      Department: "Pharmacy",
      Role: "Technician",
      EmployeeId: "",
      CardId: "",
      CardExpiryDate: null as Date | null,
    },
    validationSchema: Yup.object({
      Username: Yup.string()
        .required("Username is required")
        .min(3, "Username must be at least 3 characters")
        .max(50, "Username cannot exceed 50 characters"),
      Email: Yup.string()
        .email("Invalid email format")
        .required("Email is required"),
      Password: Yup.string()
        .min(6, "Password must be at least 6 characters")
        .max(100, "Password cannot exceed 100 characters")
        .required("Password is required"),
      ConfirmPassword: Yup.string()
        .oneOf([Yup.ref("Password")], "Password and confirmation password do not match")
        .required("Password confirmation is required"),
      FirstName: Yup.string()
        .required("First name is required")
        .max(50, "First name cannot exceed 50 characters"),
      LastName: Yup.string()
        .required("Last name is required")
        .max(50, "Last name cannot exceed 50 characters"),
      Role: Yup.string()
        .required("Role is required")
        .max(50, "Role cannot exceed 50 characters"),
      PhoneNumber: Yup.string()
        .matches(/^[\d\s\+\-\(\)]+$/, "Invalid phone number format"),
      Department: Yup.string()
        .max(100, "Department cannot exceed 100 characters"),
      EmployeeId: Yup.string()
        .max(50, "Employee ID cannot exceed 50 characters"),
      CardId: Yup.string()
        .max(50, "Card ID cannot exceed 50 characters"),
    }),
    onSubmit: (values) => {
      // Format CardExpiryDate as ISO string if it exists
      const formattedValues = {
        ...values,
        CardExpiryDate: values.CardExpiryDate ? new Date(values.CardExpiryDate).toISOString() : null
      };
      
      // Submit to the API with exact field names matching the backend DTO
      addUserMutation.mutate(formattedValues);
    },
  });

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleSettingChange = (key: string, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  // Save settings mutation
  const saveSettingsMutation = useMutation({
    mutationFn: (settings: any) => settingsApi.updateSettings(settings),
    onSuccess: () => {
      setSuccessMessage("Settings saved successfully");
      setTimeout(() => setSuccessMessage(""), 3000);
      
      // No need to manually refetch as we're handling this in useEffect
    },
    onError: (error: any) => {
      setErrorMessage(`Error saving settings: ${error.message}`);
      setTimeout(() => setErrorMessage(""), 5000);
    },
  });

  const saveSettings = saveSettingsMutation.mutate;
  const isSaving = saveSettingsMutation.isPending;

  // Handle mutation state changes
  useEffect(() => {
    if (saveSettingsMutation.isSuccess) {
      console.log("Settings saved successfully:", saveSettingsMutation.data);
    }

    if (saveSettingsMutation.isError) {
      const error = saveSettingsMutation.error as any;
      console.error("Error saving settings:", error);
      // Show error message
      setErrorMessage(
        `Error saving settings: ${error?.message || "Unknown error"}`
      );
      setTimeout(() => setErrorMessage(""), 5000); // Clear message after 5 seconds
    }
  }, [saveSettingsMutation.isSuccess, saveSettingsMutation.isError, saveSettingsMutation.data, saveSettingsMutation.error]);

  const { data: settingsData, isPending: isLoadingSettings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsApi.getSettings().then((res) => res.data),
  });

  // Use React's useEffect to handle the data when it changes
  useEffect(() => {
    if (settingsData) {
      console.log("Settings loaded:", settingsData);
      // Convert backend settings format to frontend format
      setSettings({
        pharmacyName: settingsData.pharmacyName || "IGS Pharmacy",
        address: settingsData.address || "123 Main Street, City, State 12345",
        phone: settingsData.phone || "(555) 123-4567",
        email: settingsData.email || "info@igspharmacy.com",
        lowStockAlerts: settingsData.lowStockAlerts ?? true,
        expiryAlerts: settingsData.expiryAlerts ?? true,
        prescriptionReminders: settingsData.prescriptionReminders ?? true,
        emailNotifications: settingsData.emailNotifications ?? true,
        smsNotifications: settingsData.smsNotifications ?? false,
        autoReorder: settingsData.autoReorder ?? true,
        reorderThreshold: settingsData.reorderThreshold || 10,
        defaultSupplier: settingsData.defaultSupplier || "MedSupply Co.",
        sessionTimeout: settingsData.sessionTimeout || 30,
        requirePasswordChange: settingsData.requirePasswordChange ?? true,
        twoFactorAuth: settingsData.twoFactorAuth ?? false,
        autoBackup: settingsData.autoBackup ?? true,
        backupFrequency: settingsData.backupFrequency || "daily",
        retentionDays: settingsData.retentionDays || 30,
      });
    }
  }, [settingsData]);

  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const handleSaveSettings = () => {
    console.log("Saving settings:", settings);
    saveSettings(settings);
  };

  const handleBackup = () => {
    console.log("Creating backup...");
    // Implementation for creating backup
  };

  const handleRestore = () => {
    console.log("Restoring from backup...");
    // Implementation for restoring from backup
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Settings
      </Typography>

      {isLoadingSettings && <Alert severity="info">Loading settings...</Alert>}

      {successMessage && <Alert severity="success">{successMessage}</Alert>}

      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      <Paper sx={{ width: "100%" }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          aria-label="settings tabs"
        >
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
                onChange={(e) =>
                  handleSettingChange("pharmacyName", e.target.value)
                }
                margin="normal"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Phone Number"
                value={settings.phone}
                onChange={(e) => handleSettingChange("phone", e.target.value)}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Address"
                value={settings.address}
                onChange={(e) => handleSettingChange("address", e.target.value)}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={settings.email}
                onChange={(e) => handleSettingChange("email", e.target.value)}
                margin="normal"
              />
            </Grid>
            <Grid item xs={12}>
              <Button
                variant="contained"
                onClick={handleSaveSettings}
                startIcon={<Save />}
              >
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
                    onChange={(e) =>
                      handleSettingChange("lowStockAlerts", e.target.checked)
                    }
                  />
                }
                label="Low Stock Alerts"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.expiryAlerts}
                    onChange={(e) =>
                      handleSettingChange("expiryAlerts", e.target.checked)
                    }
                  />
                }
                label="Expiry Date Alerts"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.prescriptionReminders}
                    onChange={(e) =>
                      handleSettingChange(
                        "prescriptionReminders",
                        e.target.checked
                      )
                    }
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
                    onChange={(e) =>
                      handleSettingChange(
                        "emailNotifications",
                        e.target.checked
                      )
                    }
                  />
                }
                label="Email Notifications"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.smsNotifications}
                    onChange={(e) =>
                      handleSettingChange("smsNotifications", e.target.checked)
                    }
                  />
                }
                label="SMS Notifications"
              />
            </Grid>
            <Grid item xs={12}>
              <Button
                variant="contained"
                onClick={handleSaveSettings}
                startIcon={<Save />}
              >
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
                    onChange={(e) =>
                      handleSettingChange("autoReorder", e.target.checked)
                    }
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
                onChange={(e) =>
                  handleSettingChange(
                    "reorderThreshold",
                    parseInt(e.target.value)
                  )
                }
                helperText="Minimum stock level before reordering"
                margin="normal"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Default Supplier"
                value={settings.defaultSupplier}
                onChange={(e) =>
                  handleSettingChange("defaultSupplier", e.target.value)
                }
                margin="normal"
              />
            </Grid>
            <Grid item xs={12}>
              <Button
                variant="contained"
                onClick={handleSaveSettings}
                startIcon={<Save />}
              >
                Save Inventory Settings
              </Button>
            </Grid>
          </Grid>
        </TabPanel>

        {/* User Management */}
        <TabPanel value={tabValue} index={3}>
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            mb={2}
          >
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
                  secondary={`${user.email} • ${user.role} • ${
                    user.active ? "Active" : "Inactive"
                  }`}
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
                onChange={(e) =>
                  handleSettingChange(
                    "sessionTimeout",
                    parseInt(e.target.value)
                  )
                }
                margin="normal"
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.requirePasswordChange}
                    onChange={(e) =>
                      handleSettingChange(
                        "requirePasswordChange",
                        e.target.checked
                      )
                    }
                  />
                }
                label="Require Regular Password Changes"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.twoFactorAuth}
                    onChange={(e) =>
                      handleSettingChange("twoFactorAuth", e.target.checked)
                    }
                  />
                }
                label="Enable Two-Factor Authentication"
              />
            </Grid>
            <Grid item xs={12}>
              <Alert severity="info">
                Two-factor authentication adds an extra layer of security to
                user accounts.
              </Alert>
            </Grid>
            <Grid item xs={12}>
              <Button
                variant="contained"
                onClick={handleSaveSettings}
                startIcon={<Save />}
              >
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
                    onChange={(e) =>
                      handleSettingChange("autoBackup", e.target.checked)
                    }
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
                onChange={(e) =>
                  handleSettingChange("backupFrequency", e.target.value)
                }
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
                onChange={(e) =>
                  handleSettingChange("retentionDays", parseInt(e.target.value))
                }
                margin="normal"
              />
            </Grid>
            <Grid item xs={12}>
              <Box display="flex" gap={2}>
                <Button
                  variant="contained"
                  onClick={handleBackup}
                  startIcon={<Backup />}
                >
                  Create Backup Now
                </Button>
                <Button
                  variant="outlined"
                  onClick={handleRestore}
                  startIcon={<RestoreFromTrash />}
                >
                  Restore from Backup
                </Button>
              </Box>
            </Grid>
            <Grid item xs={12}>
              <Alert severity="warning">
                Regular backups are essential for data protection. Ensure
                backups are stored securely.
              </Alert>
            </Grid>
          </Grid>
        </TabPanel>
      </Paper>

      {/* User Form Dialog */}
      <Dialog
        open={isUserDialogOpen}
        onClose={() => setIsUserDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add New User</DialogTitle>
        <form onSubmit={userFormik.handleSubmit}>
          <DialogContent>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="FirstName"
                  label="First Name"
                  value={userFormik.values.FirstName}
                  onChange={userFormik.handleChange}
                  error={userFormik.touched.FirstName && Boolean(userFormik.errors.FirstName)}
                  helperText={userFormik.touched.FirstName && userFormik.errors.FirstName}
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="LastName"
                  label="Last Name"
                  value={userFormik.values.LastName}
                  onChange={userFormik.handleChange}
                  error={userFormik.touched.LastName && Boolean(userFormik.errors.LastName)}
                  helperText={userFormik.touched.LastName && userFormik.errors.LastName}
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="Username"
                  label="Username"
                  value={userFormik.values.Username}
                  onChange={userFormik.handleChange}
                  error={userFormik.touched.Username && Boolean(userFormik.errors.Username)}
                  helperText={userFormik.touched.Username && userFormik.errors.Username}
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="Email"
                  label="Email"
                  type="email"
                  value={userFormik.values.Email}
                  onChange={userFormik.handleChange}
                  error={userFormik.touched.Email && Boolean(userFormik.errors.Email)}
                  helperText={userFormik.touched.Email && userFormik.errors.Email}
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="PhoneNumber"
                  label="Phone Number"
                  value={userFormik.values.PhoneNumber}
                  onChange={userFormik.handleChange}
                  error={userFormik.touched.PhoneNumber && Boolean(userFormik.errors.PhoneNumber)}
                  helperText={userFormik.touched.PhoneNumber && userFormik.errors.PhoneNumber}
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="Department"
                  label="Department"
                  value={userFormik.values.Department}
                  onChange={userFormik.handleChange}
                  error={userFormik.touched.Department && Boolean(userFormik.errors.Department)}
                  helperText={userFormik.touched.Department && userFormik.errors.Department}
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="EmployeeId"
                  label="Employee ID (Optional)"
                  value={userFormik.values.EmployeeId}
                  onChange={userFormik.handleChange}
                  error={userFormik.touched.EmployeeId && Boolean(userFormik.errors.EmployeeId)}
                  helperText={userFormik.touched.EmployeeId && userFormik.errors.EmployeeId}
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="CardId"
                  label="Card ID (Optional)"
                  value={userFormik.values.CardId}
                  onChange={userFormik.handleChange}
                  error={userFormik.touched.CardId && Boolean(userFormik.errors.CardId)}
                  helperText={userFormik.touched.CardId && userFormik.errors.CardId}
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  select
                  name="Role"
                  label="Role"
                  value={userFormik.values.Role}
                  onChange={userFormik.handleChange}
                  margin="normal"
                  SelectProps={{ native: true }}
                >
                  <option value="Admin">Admin</option>
                  <option value="Pharmacist">Pharmacist</option>
                  <option value="Technician">Technician</option>
                </TextField>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="Password"
                  label="Password"
                  type="password"
                  value={userFormik.values.Password}
                  onChange={userFormik.handleChange}
                  error={userFormik.touched.Password && Boolean(userFormik.errors.Password)}
                  helperText={userFormik.touched.Password && userFormik.errors.Password}
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="ConfirmPassword"
                  label="Confirm Password"
                  type="password"
                  value={userFormik.values.ConfirmPassword}
                  onChange={userFormik.handleChange}
                  error={userFormik.touched.ConfirmPassword && Boolean(userFormik.errors.ConfirmPassword)}
                  helperText={userFormik.touched.ConfirmPassword && userFormik.errors.ConfirmPassword}
                  margin="normal"
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setIsUserDialogOpen(false)}>Cancel</Button>
            <Button 
              type="submit" 
              variant="contained" 
              disabled={addUserMutation.isPending}
            >
              {addUserMutation.isPending ? "Adding..." : "Add User"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
};

export default Settings;
