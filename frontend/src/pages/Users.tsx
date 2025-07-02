import React, { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Box,
  Typography,
  Paper,
  Button,
  TextField,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Alert,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
} from "@mui/material";
import { useFormik } from "formik";
import * as Yup from "yup";
import { authApi } from "../services/api";
import { Add, Delete, Edit } from "@mui/icons-material";
import { formatApiError, logError } from "../utils/errorHandler";

const Users: React.FC = () => {
  const [users, setUsers] = useState<any[]>([]);
  const [isUserDialogOpen, setIsUserDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState<any | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  // Debug: Check if auth token exists
  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    console.log("Auth token exists:", !!token);
    if (token) {
      console.log("Token starts with:", token.substring(0, 10));
    }

    const user = localStorage.getItem("auth_user");
    console.log("Auth user exists:", !!user);
    if (user) {
      try {
        const parsedUser = JSON.parse(user);
        console.log("User role:", parsedUser.role);
        console.log("User permissions:", parsedUser.permissions);
      } catch (e) {
        console.error("Error parsing user:", e);
      }
    }
  }, []);

  // Fetch users from backend
  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      console.log("Fetching users from API...");
      try {
        const response = await authApi.getAllUsers();
        console.log("Full API response:", response);
        console.log("Response status:", response.status);
        console.log("Response data type:", typeof response.data);
        console.log("User API response data:", response.data);

        // Handle different response formats
        if (Array.isArray(response.data)) {
          // If response.data is already an array of users
          console.log(
            "Response data is an array with",
            response.data.length,
            "items"
          );
          return response.data;
        } else if (
          response.data &&
          response.data.users &&
          Array.isArray(response.data.users)
        ) {
          // If response.data has a users array property
          console.log(
            "Found users array in response.data.users with",
            response.data.users.length,
            "items"
          );
          return response.data.users;
        } else if (
          response.data &&
          response.data.success &&
          response.data.users &&
          Array.isArray(response.data.users)
        ) {
          // Handle the specific format from our backend: { success: true, users: [...] }
          console.log(
            "Found users array in response.data.users with",
            response.data.users.length,
            "items"
          );
          return response.data.users;
        } else if (response.data && typeof response.data === "object") {
          // Last resort - try to extract users from unknown object structure
          console.log(
            "Unknown user response format, attempting to extract users"
          );
          console.log("Object keys:", Object.keys(response.data));
          for (const key in response.data) {
            if (Array.isArray(response.data[key])) {
              console.log(
                `Found array at key: ${key} with ${response.data[key].length} items, using as users list`
              );
              return response.data[key];
            }
          }
        }

        // Fallback to empty array if no users found
        console.warn(
          "Could not extract users from response, defaulting to empty array"
        );
        return [];
      } catch (error) {
        console.error("Error fetching users:", error);
        throw error;
      }
    },
  });

  // Update users state when query data changes
  useEffect(() => {
    if (usersQuery.data) {
      console.log("Raw users data from API:", usersQuery.data);

      // Handle different possible response structures
      setUsers(
        usersQuery.data.map((user: any) => ({
          id: user.id,
          // Handle both firstName/lastName and Username formats
          name:
            user.firstName && user.lastName
              ? `${user.firstName} ${user.lastName}`
              : user.username || user.Username || "Unknown",
          email: user.email || user.Email || "",
          role: user.role || user.Role || "User",
          active:
            typeof user.isActive !== "undefined"
              ? user.isActive
              : typeof user.IsActive !== "undefined"
              ? user.IsActive
              : true,
        }))
      );
    }
  }, [usersQuery.data]);

  // Handle query error
  useEffect(() => {
    if (usersQuery.error) {
      logError(usersQuery.error, "Users - Users Query");
      setErrorMessage(formatApiError(usersQuery.error));
      setTimeout(() => setErrorMessage(""), 5000);
    }
  }, [usersQuery.error]);

  // Delete user mutation
  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) => authApi.deleteUser(userId),
    onSuccess: () => {
      setSuccessMessage("User deleted successfully");
      setTimeout(() => setSuccessMessage(""), 3000);
      usersQuery.refetch();
    },
    onError: (error: any) => {
      logError(error, "Users - Delete User");
      setErrorMessage(formatApiError(error));
      setTimeout(() => setErrorMessage(""), 5000);
    },
  });

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: ({ userId, userData }: { userId: string; userData: any }) => {
      console.log("Updating user with ID:", userId);
      console.log("Update data:", JSON.stringify(userData, null, 2));
      return authApi.updateUser(userId, userData);
    },
    onSuccess: (response) => {
      console.log("Update success response:", response);
      // Show success message
      setSuccessMessage("User updated successfully");
      setTimeout(() => setSuccessMessage(""), 3000);

      // Close dialog
      setIsEditDialogOpen(false);
      setUserToEdit(null);

      // Refresh user list
      usersQuery.refetch();
    },
    onError: (error: any) => {
      console.error("Update error:", error);
      console.error("Response data:", error?.response?.data);

      // Extract detailed error information
      let errorDetails = "";
      if (error?.response?.data?.errors) {
        if (typeof error.response.data.errors === "object") {
          Object.entries(error.response.data.errors).forEach(
            ([field, messages]) => {
              const formattedField =
                field.charAt(0).toUpperCase() + field.slice(1);
              const messageStr = Array.isArray(messages)
                ? (messages as string[]).join(", ")
                : String(messages);
              errorDetails += `${formattedField}: ${messageStr}\n`;

              // Set field errors in formik if they exist
              if (editFormik.setFieldError && editFormik.setFieldTouched) {
                editFormik.setFieldTouched(field, true, false);
                editFormik.setFieldError(field, messageStr);
              }
            }
          );
        } else if (Array.isArray(error.response.data.errors)) {
          errorDetails = error.response.data.errors.join(", ");
        }
      } else if (
        error?.response?.data?.title ||
        error?.response?.data?.detail
      ) {
        errorDetails = error.response.data.title || error.response.data.detail;
      }

      // Show error message
      const errorMessage =
        error?.response?.data?.message ||
        errorDetails ||
        error?.message ||
        "Unknown error";
      setErrorMessage(`Error updating user: ${errorMessage}`);
      setTimeout(() => setErrorMessage(""), 8000);
    },
  });

  // Add user mutation
  const addUserMutation = useMutation({
    mutationFn: (userData: any) => {
      console.log(
        "Sending user registration data:",
        JSON.stringify(userData, null, 2)
      );
      return authApi.register(userData);
    },
    onSuccess: (response) => {
      console.log("Registration success response:", response);
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
      let errorDetails = "";
      if (error?.response?.data?.errors) {
        if (typeof error.response.data.errors === "object") {
          // Handle case where errors is an object with field names as keys
          Object.entries(error.response.data.errors).forEach(
            ([field, messages]) => {
              // Format the field name for display
              const formattedField =
                field.charAt(0).toUpperCase() + field.slice(1); // Capitalize field name
              const messageStr = Array.isArray(messages)
                ? (messages as string[]).join(", ")
                : String(messages);
              errorDetails += `${formattedField}: ${messageStr}\n`;

              // Set field errors in formik if they exist
              if (userFormik.setFieldError && userFormik.setFieldTouched) {
                // Match our PascalCase field names
                userFormik.setFieldTouched(field, true, false);
                userFormik.setFieldError(field, messageStr);
              }
            }
          );
        } else if (Array.isArray(error.response.data.errors)) {
          // Handle case where errors is an array of strings
          errorDetails = error.response.data.errors.join(", ");
        }
      } else if (
        error?.response?.data?.title ||
        error?.response?.data?.detail
      ) {
        // Handle ASP.NET Core ProblemDetails format
        errorDetails = error.response.data.title || error.response.data.detail;
      }

      // Show error message
      const errorMessage =
        error?.response?.data?.message ||
        errorDetails ||
        error?.message ||
        "Unknown error";
      setErrorMessage(`Error adding user: ${errorMessage}`);
      setTimeout(() => setErrorMessage(""), 8000); // Give more time to read detailed errors
    },
  });

  // Edit user form
  const editFormik = useFormik({
    initialValues: {
      FirstName: "",
      LastName: "",
      Email: "",
      PhoneNumber: "",
      Department: "",
    },
    validationSchema: Yup.object({
      FirstName: Yup.string().max(50, "First name cannot exceed 50 characters"),
      LastName: Yup.string().max(50, "Last name cannot exceed 50 characters"),
      Email: Yup.string().email("Invalid email format"),
      PhoneNumber: Yup.string().matches(
        /^[\d\s\+\-\(\)]*$/,
        "Invalid phone number format"
      ),
      Department: Yup.string().max(
        100,
        "Department cannot exceed 100 characters"
      ),
    }),
    onSubmit: (values) => {
      if (!userToEdit) return;

      // Only include fields that have been changed
      const updateData: Record<string, any> = {};
      Object.keys(values).forEach((key) => {
        const typedKey = key as keyof typeof values;
        if (values[typedKey] !== "") {
          updateData[key] = values[typedKey];
        }
      });

      // Submit to the API
      updateUserMutation.mutate({
        userId: userToEdit.id,
        userData: updateData,
      });
    },
    enableReinitialize: true,
  });

  // Reset edit form when user to edit changes
  useEffect(() => {
    if (userToEdit) {
      editFormik.setValues({
        FirstName: "",
        LastName: "",
        Email: "",
        PhoneNumber: "",
        Department: "",
      });
    }
  }, [userToEdit]);

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
        .oneOf(
          [Yup.ref("Password")],
          "Password and confirmation password do not match"
        )
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
      PhoneNumber: Yup.string().matches(
        /^[\d\s\+\-\(\)]+$/,
        "Invalid phone number format"
      ),
      Department: Yup.string().max(
        100,
        "Department cannot exceed 100 characters"
      ),
      EmployeeId: Yup.string().max(
        50,
        "Employee ID cannot exceed 50 characters"
      ),
      CardId: Yup.string().max(50, "Card ID cannot exceed 50 characters"),
    }),
    onSubmit: (values) => {
      // Format CardExpiryDate as ISO string if it exists
      const formattedValues = {
        ...values,
        CardExpiryDate: values.CardExpiryDate
          ? new Date(values.CardExpiryDate).toISOString()
          : null,
      };

      // Submit to the API with exact field names matching the backend DTO
      addUserMutation.mutate(formattedValues);
    },
  });

  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ mb: 2 }}>
        User Management
      </Typography>

      {usersQuery.isPending && <Alert severity="info">Loading users...</Alert>}

      {successMessage && <Alert severity="success">{successMessage}</Alert>}

      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      <Paper sx={{ width: "100%", p: 3 }}>
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          mb={2}
        >
          <Typography variant="h6">Users</Typography>
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
                <IconButton
                  edge="end"
                  aria-label="edit"
                  onClick={() => {
                    setUserToEdit(user);
                    setIsEditDialogOpen(true);
                  }}
                >
                  <Edit />
                </IconButton>
                <IconButton
                  edge="end"
                  aria-label="delete"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Are you sure you want to delete user ${user.name}?`
                      )
                    ) {
                      deleteUserMutation.mutate(user.id);
                    }
                  }}
                >
                  <Delete />
                </IconButton>
              </ListItemSecondaryAction>
            </ListItem>
          ))}
          {users.length === 0 && !usersQuery.isPending && (
            <ListItem>
              <ListItemText primary="No users found!" />
            </ListItem>
          )}
        </List>
      </Paper>

      {/* Add User Dialog */}
      <Dialog
        open={isUserDialogOpen}
        onClose={() => setIsUserDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Add New User</DialogTitle>
        <form onSubmit={userFormik.handleSubmit}>
          <DialogContent>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  id="Username"
                  name="Username"
                  label="Username"
                  value={userFormik.values.Username}
                  onChange={userFormik.handleChange}
                  onBlur={userFormik.handleBlur}
                  error={
                    userFormik.touched.Username &&
                    Boolean(userFormik.errors.Username)
                  }
                  helperText={
                    userFormik.touched.Username && userFormik.errors.Username
                  }
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  id="Email"
                  name="Email"
                  label="Email"
                  type="email"
                  value={userFormik.values.Email}
                  onChange={userFormik.handleChange}
                  onBlur={userFormik.handleBlur}
                  error={
                    userFormik.touched.Email && Boolean(userFormik.errors.Email)
                  }
                  helperText={
                    userFormik.touched.Email && userFormik.errors.Email
                  }
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  id="Password"
                  name="Password"
                  label="Password"
                  type="password"
                  value={userFormik.values.Password}
                  onChange={userFormik.handleChange}
                  onBlur={userFormik.handleBlur}
                  error={
                    userFormik.touched.Password &&
                    Boolean(userFormik.errors.Password)
                  }
                  helperText={
                    userFormik.touched.Password && userFormik.errors.Password
                  }
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  id="ConfirmPassword"
                  name="ConfirmPassword"
                  label="Confirm Password"
                  type="password"
                  value={userFormik.values.ConfirmPassword}
                  onChange={userFormik.handleChange}
                  onBlur={userFormik.handleBlur}
                  error={
                    userFormik.touched.ConfirmPassword &&
                    Boolean(userFormik.errors.ConfirmPassword)
                  }
                  helperText={
                    userFormik.touched.ConfirmPassword &&
                    userFormik.errors.ConfirmPassword
                  }
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  id="FirstName"
                  name="FirstName"
                  label="First Name"
                  value={userFormik.values.FirstName}
                  onChange={userFormik.handleChange}
                  onBlur={userFormik.handleBlur}
                  error={
                    userFormik.touched.FirstName &&
                    Boolean(userFormik.errors.FirstName)
                  }
                  helperText={
                    userFormik.touched.FirstName && userFormik.errors.FirstName
                  }
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  id="LastName"
                  name="LastName"
                  label="Last Name"
                  value={userFormik.values.LastName}
                  onChange={userFormik.handleChange}
                  onBlur={userFormik.handleBlur}
                  error={
                    userFormik.touched.LastName &&
                    Boolean(userFormik.errors.LastName)
                  }
                  helperText={
                    userFormik.touched.LastName && userFormik.errors.LastName
                  }
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  id="PhoneNumber"
                  name="PhoneNumber"
                  label="Phone Number"
                  value={userFormik.values.PhoneNumber}
                  onChange={userFormik.handleChange}
                  onBlur={userFormik.handleBlur}
                  error={
                    userFormik.touched.PhoneNumber &&
                    Boolean(userFormik.errors.PhoneNumber)
                  }
                  helperText={
                    userFormik.touched.PhoneNumber &&
                    userFormik.errors.PhoneNumber
                  }
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  id="Department"
                  name="Department"
                  label="Department"
                  value={userFormik.values.Department}
                  onChange={userFormik.handleChange}
                  onBlur={userFormik.handleBlur}
                  error={
                    userFormik.touched.Department &&
                    Boolean(userFormik.errors.Department)
                  }
                  helperText={
                    userFormik.touched.Department &&
                    userFormik.errors.Department
                  }
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  select
                  id="Role"
                  name="Role"
                  label="Role"
                  value={userFormik.values.Role}
                  onChange={userFormik.handleChange}
                  onBlur={userFormik.handleBlur}
                  error={
                    userFormik.touched.Role && Boolean(userFormik.errors.Role)
                  }
                  helperText={userFormik.touched.Role && userFormik.errors.Role}
                  margin="normal"
                  SelectProps={{
                    native: true,
                  }}
                >
                  <option value="Admin">Admin</option>
                  <option value="Pharmacist">Pharmacist</option>
                  <option value="Technician">Technician</option>
                  <option value="Cashier">Cashier</option>
                </TextField>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  id="EmployeeId"
                  name="EmployeeId"
                  label="Employee ID"
                  value={userFormik.values.EmployeeId}
                  onChange={userFormik.handleChange}
                  onBlur={userFormik.handleBlur}
                  error={
                    userFormik.touched.EmployeeId &&
                    Boolean(userFormik.errors.EmployeeId)
                  }
                  helperText={
                    userFormik.touched.EmployeeId &&
                    userFormik.errors.EmployeeId
                  }
                  margin="normal"
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setIsUserDialogOpen(false)} color="primary">
              Cancel
            </Button>
            <Button
              type="submit"
              color="primary"
              variant="contained"
              disabled={addUserMutation.isPending}
            >
              {addUserMutation.isPending ? "Adding..." : "Add User"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog
        open={isEditDialogOpen}
        onClose={() => {
          setIsEditDialogOpen(false);
          setUserToEdit(null);
          editFormik.resetForm();
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Edit User: {userToEdit ? userToEdit.name : ""}
        </DialogTitle>
        <form onSubmit={editFormik.handleSubmit}>
          <DialogContent>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  id="FirstName"
                  name="FirstName"
                  label="First Name"
                  placeholder={userToEdit?.name?.split(" ")[0] || ""}
                  value={editFormik.values.FirstName}
                  onChange={editFormik.handleChange}
                  onBlur={editFormik.handleBlur}
                  error={
                    editFormik.touched.FirstName &&
                    Boolean(editFormik.errors.FirstName)
                  }
                  helperText={
                    editFormik.touched.FirstName && editFormik.errors.FirstName
                  }
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  id="LastName"
                  name="LastName"
                  label="Last Name"
                  placeholder={userToEdit?.name?.split(" ")[1] || ""}
                  value={editFormik.values.LastName}
                  onChange={editFormik.handleChange}
                  onBlur={editFormik.handleBlur}
                  error={
                    editFormik.touched.LastName &&
                    Boolean(editFormik.errors.LastName)
                  }
                  helperText={
                    editFormik.touched.LastName && editFormik.errors.LastName
                  }
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  id="Email"
                  name="Email"
                  label="Email"
                  type="email"
                  placeholder={userToEdit?.email || ""}
                  value={editFormik.values.Email}
                  onChange={editFormik.handleChange}
                  onBlur={editFormik.handleBlur}
                  error={
                    editFormik.touched.Email && Boolean(editFormik.errors.Email)
                  }
                  helperText={
                    editFormik.touched.Email && editFormik.errors.Email
                  }
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  id="PhoneNumber"
                  name="PhoneNumber"
                  label="Phone Number"
                  placeholder="Enter new phone number"
                  value={editFormik.values.PhoneNumber}
                  onChange={editFormik.handleChange}
                  onBlur={editFormik.handleBlur}
                  error={
                    editFormik.touched.PhoneNumber &&
                    Boolean(editFormik.errors.PhoneNumber)
                  }
                  helperText={
                    editFormik.touched.PhoneNumber &&
                    editFormik.errors.PhoneNumber
                  }
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  id="Department"
                  name="Department"
                  label="Department"
                  placeholder="Enter new department"
                  value={editFormik.values.Department}
                  onChange={editFormik.handleChange}
                  onBlur={editFormik.handleBlur}
                  error={
                    editFormik.touched.Department &&
                    Boolean(editFormik.errors.Department)
                  }
                  helperText={
                    editFormik.touched.Department &&
                    editFormik.errors.Department
                  }
                  margin="normal"
                />
              </Grid>
            </Grid>
            <Typography
              variant="caption"
              color="textSecondary"
              sx={{ mt: 2, display: "block" }}
            >
              Note: Leave fields blank if you don't want to update them.
              Password changes must be handled separately.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setIsEditDialogOpen(false);
                setUserToEdit(null);
                editFormik.resetForm();
              }}
              color="primary"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              color="primary"
              variant="contained"
              disabled={updateUserMutation.isPending}
            >
              {updateUserMutation.isPending ? "Updating..." : "Update User"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
};

export default Users;
