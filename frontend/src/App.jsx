import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Login from './pages/Login.jsx';
import PublicUpload from './pages/PublicUpload.jsx';
import PublicFormular from './pages/PublicFormular.jsx';
import PublicFunnel from './pages/PublicFunnel.jsx';
import PublicReview from './pages/PublicReview.jsx';
import DashboardLayout from './layout/DashboardLayout.jsx';
import KundenList from './pages/KundenList.jsx';
import KundeDetail from './pages/KundeDetail.jsx';
import JobView from './pages/JobView.jsx';
import JobStelleninfos from './pages/job/JobStelleninfos.jsx';
import JobCreatives from './pages/job/JobCreatives.jsx';
import JobAdCopies from './pages/job/JobAdCopies.jsx';
import JobFunnel from './pages/job/JobFunnel.jsx';
import JobExport from './pages/job/JobExport.jsx';

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
      <Route path="/upload/:token" element={<PublicUpload />} />
      <Route path="/formular/:token" element={<PublicFormular />} />
      <Route path="/f/:funnelId" element={<PublicFunnel />} />
      <Route path="/review/:token" element={<PublicReview />} />
      <Route
        path="/"
        element={
          <Protected>
            <DashboardLayout />
          </Protected>
        }
      >
        <Route index element={<Navigate to="/kunden" replace />} />
        <Route path="kunden" element={<KundenList />} />
        <Route path="kunden/:kundeId" element={<KundeDetail />} />
        <Route path="kunden/:kundeId/jobs/:jobId" element={<JobView />}>
          <Route index element={<Navigate to="stelle" replace />} />
          <Route path="stelle" element={<JobStelleninfos />} />
          <Route path="creatives" element={<JobCreatives />} />
          <Route path="adcopies" element={<JobAdCopies />} />
          <Route path="funnel" element={<JobFunnel />} />
          <Route path="export" element={<JobExport />} />
        </Route>
      </Route>
    </Routes>
  );
}
