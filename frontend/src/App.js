import React, { useEffect } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import { OfflineBanner, UpdateNotification } from "@/components/PWAIndicators";

// Pages
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import CustomersPage from "@/pages/CustomersPage";
import CustomerDetailPage from "@/pages/CustomerDetailPage";
import TransactionsPage from "@/pages/TransactionsPage";
import NewTransactionPage from "@/pages/NewTransactionPage";
import PaymentsPage from "@/pages/PaymentsPage";
import CollectionsPage from "@/pages/CollectionsPage";
import AdjustmentsPage from "@/pages/AdjustmentsPage";
import GatewayWalletPage from "@/pages/GatewayWalletPage";
import GatewayServersPage from "@/pages/GatewayServersPage";
import PGAndServersPage from "@/pages/PGAndServersPage";
import BanksAndCardsPage from "@/pages/BanksAndCardsPage";
import WalletsPage from "@/pages/WalletsPage";
import WalletOperationsPage from "@/pages/WalletOperationsPage";
import UsersPage from "@/pages/UsersPage";
import RolesPage from "@/pages/RolesPage";
import AuditLogPage from "@/pages/AuditLogPage";
import DailyClosingPage from "@/pages/DailyClosingPage";
import SettingsPage from "@/pages/SettingsPage";
import ReconciliationPage from "@/pages/ReconciliationPage";
import BalanceVerificationPage from "@/pages/BalanceVerificationPage";
import ExpensesPage from "@/pages/ExpensesPage";
import ExpenseTypesPage from "@/pages/ExpenseTypesPage";
import DataIntegrityPage from "@/pages/DataIntegrityPage";
import ResetPage from "@/pages/ResetPage";
import DownloadsPage from "@/pages/DownloadsPage";
import ReportsPage from "@/pages/ReportsPage";
import SecurityPage from "@/pages/SecurityPage";

// Layout
import MainLayout from "@/components/layout/MainLayout";

// Protected Route Component - checks authentication
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

// Module Guard - checks permission for a specific module
const ModuleGuard = ({ module, children }) => {
  const { hasPermission } = useAuth();
  if (!hasPermission(module)) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
};

// Public Route Component (redirects to dashboard if authenticated)
const PublicRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

function AppRoutes() {
  return (
    <Routes>
      {/* Public Routes */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />

      {/* Protected Routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<ModuleGuard module="dashboard"><DashboardPage /></ModuleGuard>} />
        
        <Route path="customers" element={<ModuleGuard module="customers"><CustomersPage /></ModuleGuard>} />
        <Route path="customers/:id" element={<ModuleGuard module="customers"><CustomerDetailPage /></ModuleGuard>} />
        
        <Route path="transactions" element={<ModuleGuard module="transactions"><TransactionsPage /></ModuleGuard>} />
        <Route path="transactions/new" element={<ModuleGuard module="transactions"><NewTransactionPage /></ModuleGuard>} />
        
        {/* Payments & Collections pages */}
        <Route path="payments" element={<ModuleGuard module="payments"><PaymentsPage /></ModuleGuard>} />
        <Route path="collections" element={<ModuleGuard module="collections"><CollectionsPage /></ModuleGuard>} />
        <Route path="adjustments" element={<ModuleGuard module="adjustments"><AdjustmentsPage /></ModuleGuard>} />
        
        {/* Wallets */}
        <Route path="wallets" element={<ModuleGuard module="wallets"><WalletsPage /></ModuleGuard>} />
        <Route path="wallets/:walletId/operations" element={<ModuleGuard module="wallets"><WalletOperationsPage /></ModuleGuard>} />
        
        <Route path="pg-and-servers" element={<ModuleGuard module="pg-and-servers"><PGAndServersPage /></ModuleGuard>} />
        <Route path="gateways/:id/wallet" element={<ModuleGuard module="pg-and-servers"><GatewayWalletPage /></ModuleGuard>} />
        <Route path="gateways/:gatewayId/servers" element={<ModuleGuard module="pg-and-servers"><GatewayServersPage /></ModuleGuard>} />
        
        <Route path="banks-and-cards" element={<ModuleGuard module="banks-and-cards"><BanksAndCardsPage /></ModuleGuard>} />
        
        <Route path="users" element={<ModuleGuard module="users"><UsersPage /></ModuleGuard>} />
        <Route path="roles" element={<ModuleGuard module="roles"><RolesPage /></ModuleGuard>} />
        
        <Route path="audit-log" element={<ModuleGuard module="audit-log"><AuditLogPage /></ModuleGuard>} />
        <Route path="daily-closing" element={<ModuleGuard module="daily-closing"><DailyClosingPage /></ModuleGuard>} />
        <Route path="expenses" element={<ModuleGuard module="expenses"><ExpensesPage /></ModuleGuard>} />
        <Route path="expense-types" element={<ModuleGuard module="expense-types"><ExpenseTypesPage /></ModuleGuard>} />
        <Route path="reconciliation" element={<ModuleGuard module="reconciliation"><ReconciliationPage /></ModuleGuard>} />
        <Route path="balance-verification" element={<ModuleGuard module="balance-verification"><BalanceVerificationPage /></ModuleGuard>} />
        <Route path="data-integrity" element={<ModuleGuard module="data-integrity"><DataIntegrityPage /></ModuleGuard>} />
        <Route path="system-reset" element={<ModuleGuard module="system-reset"><ResetPage /></ModuleGuard>} />
        <Route path="security" element={<ModuleGuard module="security"><SecurityPage /></ModuleGuard>} />
        <Route path="downloads" element={<ModuleGuard module="downloads"><DownloadsPage /></ModuleGuard>} />
        <Route path="reports" element={<ModuleGuard module="reports"><ReportsPage /></ModuleGuard>} />
        <Route path="settings" element={<ModuleGuard module="settings"><SettingsPage /></ModuleGuard>} />
      </Route>

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function App() {
  // Prevent mouse scroll from changing values in number inputs (browser default behaviour)
  useEffect(() => {
    const handleWheel = () => {
      if (document.activeElement?.type === 'number') {
        document.activeElement.blur();
      }
    };
    document.addEventListener('wheel', handleWheel, { passive: true });
    return () => document.removeEventListener('wheel', handleWheel);
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <OfflineBanner />
        <UpdateNotification />
        <AppRoutes />
        <Toaster position="top-right" richColors closeButton />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
