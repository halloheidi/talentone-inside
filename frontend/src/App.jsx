import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Login from './pages/Login.jsx';
import DashboardLayout from './layout/DashboardLayout.jsx';
import Kunden from './pages/Kunden.jsx';
import Creatives from './pages/Creatives.jsx';
import AdCopies from './pages/AdCopies.jsx';
import Funnel from './pages/Funnel.jsx';
import Export from './pages/Export.jsx';

function Protected({ children }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="full-loading">Lade…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <DashboardLayout />
          </Protected>
        }
      >
        <Route index element={<Navigate to="/kunden" replace />} />
        <Route path="kunden" element={<Kunden />} />
        <Route path="creatives" element={<Creatives />} />
        <Route path="adcopies" element={<AdCopies />} />
        <Route path="funnel" element={<Funnel />} />
        <Route path="export" element={<Export />} />
      </Route>
    </Routes>
  );
}
