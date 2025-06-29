import React, { useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
  TextField,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  Assessment,
  TrendingUp,
  Inventory,
  People,
  LocalPharmacy,
  AttachMoney,
  Download,
  Print,
} from '@mui/icons-material';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../services/api';

const Reports: React.FC = () => {
  const [reportType, setReportType] = useState('sales');
  const [dateRange, setDateRange] = useState('month');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const { data: salesReport } = useQuery({
    queryKey: ['reports', 'sales', dateRange],
    queryFn: () => reportsApi.getSalesReport(dateRange).then(res => res.data),
  });

  const { data: inventoryReport } = useQuery({
    queryKey: ['reports', 'inventory'],
    queryFn: () => reportsApi.getInventoryReport().then(res => res.data),
  });

  const { data: prescriptionReport } = useQuery({
    queryKey: ['reports', 'prescriptions', dateRange],
    queryFn: () => reportsApi.getPrescriptionReport(dateRange).then(res => res.data),
  });

  // Mock data for charts
  const salesData = [
    { month: 'Jan', sales: 12000, prescriptions: 450 },
    { month: 'Feb', sales: 15000, prescriptions: 520 },
    { month: 'Mar', sales: 18000, prescriptions: 680 },
    { month: 'Apr', sales: 14000, prescriptions: 590 },
    { month: 'May', sales: 22000, prescriptions: 750 },
    { month: 'Jun', sales: 25000, prescriptions: 820 },
  ];

  const categoryData = [
    { name: 'Pain Relief', value: 35, color: '#8884d8' },
    { name: 'Antibiotics', value: 25, color: '#82ca9d' },
    { name: 'Vitamins', value: 20, color: '#ffc658' },
    { name: 'Heart Medication', value: 15, color: '#ff7300' },
    { name: 'Others', value: 5, color: '#00ff00' },
  ];

  const topProducts = [
    { name: 'Ibuprofen 400mg', sales: 1250, revenue: 15000 },
    { name: 'Amoxicillin 500mg', sales: 980, revenue: 12500 },
    { name: 'Vitamin D3', sales: 850, revenue: 8500 },
    { name: 'Lisinopril 10mg', sales: 720, revenue: 14400 },
    { name: 'Metformin 500mg', sales: 650, revenue: 9750 },
  ];

  const handleExportReport = (format: 'pdf' | 'excel') => {
    // Implementation for exporting reports
    console.log(`Exporting ${reportType} report as ${format}`);
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Reports & Analytics
      </Typography>

      {/* Report Controls */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={3} alignItems="center">
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                fullWidth
                select
                label="Report Type"
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
              >
                <MenuItem value="sales">Sales Report</MenuItem>
                <MenuItem value="inventory">Inventory Report</MenuItem>
                <MenuItem value="prescriptions">Prescription Report</MenuItem>
                <MenuItem value="financial">Financial Report</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                fullWidth
                select
                label="Date Range"
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
              >
                <MenuItem value="week">This Week</MenuItem>
                <MenuItem value="month">This Month</MenuItem>
                <MenuItem value="quarter">This Quarter</MenuItem>
                <MenuItem value="year">This Year</MenuItem>
                <MenuItem value="custom">Custom Range</MenuItem>
              </TextField>
            </Grid>
            {dateRange === 'custom' && (
              <>
                <Grid item xs={12} sm={6} md={2}>
                  <TextField
                    fullWidth
                    type="date"
                    label="Start Date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={2}>
                  <TextField
                    fullWidth
                    type="date"
                    label="End Date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
              </>
            )}
            <Grid item xs={12} sm={6} md={2}>
              <Box display="flex" gap={1}>
                <Button
                  variant="outlined"
                  startIcon={<Download />}
                  onClick={() => handleExportReport('excel')}
                  size="small"
                >
                  Excel
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<Print />}
                  onClick={() => handleExportReport('pdf')}
                  size="small"
                >
                  PDF
                </Button>
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center">
                <AttachMoney color="success" sx={{ mr: 2 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Total Revenue
                  </Typography>
                  <Typography variant="h5">
                    $125,450
                  </Typography>
                  <Typography variant="body2" color="success.main">
                    +12.5% from last month
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
                <TrendingUp color="primary" sx={{ mr: 2 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Total Sales
                  </Typography>
                  <Typography variant="h5">
                    2,847
                  </Typography>
                  <Typography variant="body2" color="primary.main">
                    +8.2% from last month
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
                <LocalPharmacy color="info" sx={{ mr: 2 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Prescriptions Filled
                  </Typography>
                  <Typography variant="h5">
                    1,234
                  </Typography>
                  <Typography variant="body2" color="info.main">
                    +15.3% from last month
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
                <People color="secondary" sx={{ mr: 2 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Active Patients
                  </Typography>
                  <Typography variant="h5">
                    856
                  </Typography>
                  <Typography variant="body2" color="secondary.main">
                    +5.7% from last month
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Charts */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} lg={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Sales & Prescription Trends
              </Typography>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={salesData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="sales" stroke="#8884d8" name="Sales ($)" />
                  <Line type="monotone" dataKey="prescriptions" stroke="#82ca9d" name="Prescriptions" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} lg={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Sales by Category
              </Typography>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {categoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Top Products Table */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Top Selling Products
          </Typography>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Product Name</TableCell>
                  <TableCell align="right">Units Sold</TableCell>
                  <TableCell align="right">Revenue</TableCell>
                  <TableCell align="right">Growth</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {topProducts.map((product, index) => (
                  <TableRow key={index}>
                    <TableCell>{product.name}</TableCell>
                    <TableCell align="right">{product.sales.toLocaleString()}</TableCell>
                    <TableCell align="right">${product.revenue.toLocaleString()}</TableCell>
                    <TableCell align="right">
                      <Typography color="success.main">
                        +{Math.floor(Math.random() * 20 + 5)}%
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Monthly Revenue Chart */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Monthly Revenue Breakdown
          </Typography>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={salesData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="sales" fill="#8884d8" name="Revenue ($)" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </Box>
  );
};

export default Reports;
