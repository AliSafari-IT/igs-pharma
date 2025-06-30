# IGS Pharma - Enhanced Pharmacy Management System

A comprehensive pharmacy management system built with React TypeScript frontend, .NET Core backend, and MySQL database.

## Features

### Core Pharmacy Management

- **Inventory Management**: Track medications, supplies, and equipment
- **Prescription Management**: Handle prescriptions, refills, and patient records
- **Sales & Billing**: Point-of-sale system with receipt generation
- **Patient Management**: Customer profiles and medication history
- **Supplier Management**: Vendor relationships and purchase orders
- **Reporting & Analytics**: Sales reports, inventory reports, and analytics

### Automation Features

- **Low Stock Alerts**: Automatic notifications for inventory replenishment
- **Prescription Reminders**: Patient notification system
- **Expiry Date Tracking**: Automated alerts for expiring medications
- **Auto-Reordering**: Intelligent inventory replenishment
- **Insurance Verification**: Automated insurance claim processing

## Technology Stack

### Frontend

- React 18 with TypeScript
- Vite for fast development and building
- Material-UI (MUI) for modern UI components
- React Router v6 for navigation
- TanStack React Query for data fetching and caching
- Formik & Yup for form handling and validation
- Recharts for analytics and reporting
- Vitest for testing with Jest DOM matchers
- pnpm as package manager

### Backend

- .NET 8 Core Web API
- Clean Architecture pattern
- Entity Framework Core with MySQL
- JWT Authentication & Authorization
- AutoMapper for object mapping
- FluentValidation for input validation
- Swagger/OpenAPI documentation

### Database

- MySQL 8.0
- Entity Framework Core migrations
- Optimized indexing for performance

## Project Structure

```
igs-pharma/
├── backend/
│   ├── src/
│   │   ├── IGS.Domain/           # Domain entities and interfaces
│   │   ├── IGS.Application/      # Business logic and use cases
│   │   ├── IGS.Infrastructure/   # Data access and external services
│   │   └── IGS.WebAPI/          # API controllers and configuration
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── components/          # Reusable UI components
│   │   ├── pages/              # Page components
│   │   ├── services/           # API service layer
│   │   ├── hooks/              # Custom React hooks
│   │   ├── types/              # TypeScript type definitions
│   │   └── utils/              # Utility functions
│   └── public/
└── database/
    └── migrations/             # Database migration scripts
```

## Getting Started

### Prerequisites

- Node.js 18+ and pnpm (recommended package manager)
- .NET 8 SDK
- MySQL 8.0
- Visual Studio Code or Visual Studio

### Installation

1. Clone the repository

```bash
git clone <repository-url>
cd igs-pharma
```

2. Setup Backend

```bash
cd backend
dotnet restore
dotnet ef database update
dotnet run --project src/IGS.WebAPI
```

3. Setup Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

### Environment Variables

#### Frontend (.env)

Create a `.env` file in the frontend directory:

```env
VITE_API_URL=http://localhost:5000/api
```

#### Backend

Configure your backend connection strings and JWT settings in `appsettings.json` or user secrets.

**Note**: For Vite applications, environment variables must be prefixed with `VITE_` and accessed via `import.meta.env.VITE_*`.

## License

This project is licensed under the MIT License.
