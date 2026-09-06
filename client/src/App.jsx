import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import CrudPage from './components/CrudPage.jsx';
import Login from './pages/Login.jsx';
import Monthly from './pages/Monthly.jsx';
import Audit from './pages/Audit.jsx';
import Import from './pages/Import.jsx';
import Users from './pages/Users.jsx';
import { categories, zones, districts, branches, rates, members } from './pages/masters.jsx';
import Summary from './pages/reports/Summary.jsx';
import DistrictDetail from './pages/reports/DistrictDetail.jsx';
import OneThird from './pages/reports/OneThird.jsx';
import Yearly from './pages/reports/Yearly.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="spinner">Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export default function App() {
  const { isAdmin } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Navigate to="/monthly" replace />} />

        {/* Master data */}
        <Route path="/members" element={<CrudPage config={members} canWrite={isAdmin} />} />
        <Route path="/branches" element={<CrudPage config={branches} canWrite={isAdmin} />} />
        <Route path="/districts" element={<CrudPage config={districts} canWrite={isAdmin} />} />
        <Route path="/zones" element={<CrudPage config={zones} canWrite={isAdmin} />} />
        <Route path="/categories" element={<CrudPage config={categories} canWrite={isAdmin} />} />
        <Route path="/rates" element={<CrudPage config={rates} canWrite={isAdmin} />} />

        {/* Administration */}
        <Route path="/users" element={<Users />} />

        {/* Contributions */}
        <Route path="/monthly" element={<Monthly />} />
        <Route path="/monthly/:id" element={<Audit />} />
        <Route path="/import" element={<Import />} />

        {/* Reports */}
        <Route path="/reports/summary" element={<Summary />} />
        <Route path="/reports/district" element={<DistrictDetail />} />
        <Route path="/reports/one-third" element={<OneThird />} />
        <Route path="/reports/yearly" element={<Yearly />} />

        <Route path="*" element={<div className="empty">Page not found.</div>} />
      </Route>
    </Routes>
  );
}
