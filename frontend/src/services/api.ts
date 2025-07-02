import axios from 'axios';
import { Product, CreateProduct, UpdateProduct } from '../types/Product';

// Vite uses import.meta.env instead of process.env
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor to include auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Export the main API instance
export const apiService = api;

// Product API
export const productApi = {
  getAll: () => api.get<Product[]>('/products'),
  getById: (id: number) => api.get<Product>(`/products/${id}`),
  getByCategory: (categoryId: number) => api.get<Product[]>(`/products/category/${categoryId}`),
  search: (searchTerm: string) => api.get<Product[]>(`/products/search?searchTerm=${encodeURIComponent(searchTerm)}`),
  getLowStock: () => api.get<Product[]>('/products/low-stock'),
  getExpiring: (days: number = 30) => api.get<Product[]>(`/products/expiring?days=${days}`),
  create: (product: CreateProduct) => api.post<Product>('/products', product),
  update: (id: number, product: UpdateProduct) => api.put<Product>(`/products/${id}`, product),
  delete: (id: number) => api.delete(`/products/${id}`),
  updateStock: (id: number, quantity: number, reason: string) => api.patch(`/products/${id}/stock`, { quantity, reason }),
};

// Categories API
export const categoryApi = {
  getAll: () => api.get('/categories'),
  getById: (id: number) => api.get(`/categories/${id}`),
  create: (category: any) => api.post('/categories', category),
  update: (id: number, category: any) => api.put(`/categories/${id}`, category),
  delete: (id: number) => api.delete(`/categories/${id}`),
};

// Suppliers API
export const supplierApi = {
  getAll: () => api.get('/suppliers'),
  getById: (id: number) => api.get(`/suppliers/${id}`),
  create: (supplier: any) => api.post('/suppliers', supplier),
  update: (id: number, supplier: any) => api.put(`/suppliers/${id}`, supplier),
  delete: (id: number) => api.delete(`/suppliers/${id}`),
};

// Settings API
export const settingsApi = {
  getSettings: () => api.get('/settings'),
  updateSettings: (settings: any) => api.put('/settings', settings),
};

// Patients API
export const patientApi = {
  getAll: () => api.get('/patients'),
  getById: (id: number) => api.get(`/patients/${id}`),
  search: (searchTerm: string) => api.get(`/patients/search?searchTerm=${encodeURIComponent(searchTerm)}`),
  create: (patient: any) => api.post('/patients', patient),
  update: (id: number, patient: any) => api.put(`/patients/${id}`, patient),
  delete: (id: number) => api.delete(`/patients/${id}`),
};

// Sales API
export const salesApi = {
  getAll: () => api.get('/sales'),
  getById: (id: number) => api.get(`/sales/${id}`),
  create: (sale: any) => api.post('/sales', sale),
  getByDateRange: (startDate: string, endDate: string) => 
    api.get(`/sales/date-range?startDate=${startDate}&endDate=${endDate}`),
  getDailySummary: (date: string) => api.get(`/sales/daily-summary?date=${date}`),
};

// Prescriptions API
export const prescriptionApi = {
  getAll: () => api.get('/prescriptions'),
  getById: (id: number) => api.get(`/prescriptions/${id}`),
  getByPatient: (patientId: number) => api.get(`/prescriptions/patient/${patientId}`),
  create: (prescription: any) => api.post('/prescriptions', prescription),
  update: (id: number, prescription: any) => api.put(`/prescriptions/${id}`, prescription),
  fill: (id: number) => api.patch(`/prescriptions/${id}/fill`),
};

// Authentication API
export const authApi = {
  getAllUsers: () => {
    console.log('Making API call to /Auth/users');
    console.log('Auth token:', localStorage.getItem('auth_token') ? 'exists' : 'missing');
    return api.get('/Auth/users');
  },
  login: (credentials: { username: string; password: string }) => api.post('/Auth/login', credentials),
  logout: () => api.post('/Auth/logout'),
  register: (userData: any) => api.post('/Auth/register', userData),
  updateUser: (userId: string, userData: any) => api.put(`/Auth/users/${userId}`, userData),
  deleteUser: (userId: string) => api.delete(`/Auth/users/${userId}?userId=${userId}`),
  checkUsername: (username: string) => api.get(`/Auth/check-username/${username}`),
  checkEmail: (email: string) => api.get(`/Auth/check-email/${email}`),
  checkEmployeeId: (employeeId: string) => api.get(`/Auth/check-employee-id/${employeeId}`),
  refreshToken: () => api.post('/Auth/refresh-token'),
  getCurrentUser: () => api.get('/Auth/current-user'),
};

// Reports API
export const reportsApi = {
  getSalesReport: (period: string) => api.get(`/reports/sales?period=${period}`),
  getInventoryReport: () => api.get('/reports/inventory'),
  getPrescriptionReport: (period: string) => api.get(`/reports/prescriptions?period=${period}`),
  getFinancialReport: (period: string) => api.get(`/reports/financial?period=${period}`),
};

export default api;
