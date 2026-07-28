import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Login from './pages/Login.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import PublicUpload from './pages/PublicUpload.jsx';
import PublicFormular from './pages/PublicFormular.jsx';
import PublicFunnel from './pages/PublicFunnel.jsx';
import PublicReview from './pages/PublicReview.jsx';
import PublicBewerbungen from './pages/PublicBewerbungen.jsx';
import PublicAnfragen from './pages/PublicAnfragen.jsx';
import PublicPortal from './pages/PublicPortal.jsx';
import PublicAvv from './pages/PublicAvv.jsx';
import DashboardLayout from './layout/DashboardLayout.jsx';
import KundenList from './pages/KundenList.jsx';
import KundeDetail from './pages/KundeDetail.jsx';
import BewerbungenOverview from './pages/BewerbungenOverview.jsx';
import ZahlungenOverview from './pages/ZahlungenOverview.jsx';
import ProjekteOverview from './pages/ProjekteOverview.jsx';
import LiveKampagnen from './pages/LiveKampagnen.jsx';
import AnalyseFunnel from './pages/AnalyseFunnel.jsx';
import JobView from './pages/JobView.jsx';
import JobStelleninfos from './pages/job/JobStelleninfos.jsx';
import JobCreatives from './pages/job/JobCreatives.jsx';
import JobAdCopies from './pages/job/JobAdCopies.jsx';
import JobFunnel from './pages/job/JobFunnel.jsx';
import JobExport from './pages/job/JobExport.jsx';
import OfferKatalog from './pages/admin/OfferKatalog.jsx';
import StilvorlagenAdmin from './pages/admin/Stilvorlagen.jsx';
import EigeneLeads from './pages/admin/EigeneLeads.jsx';
import Controlling from './pages/admin/Controlling.jsx';
import ControllingDashboard from './pages/ControllingDashboard.jsx';
import OfferWizard from './pages/OfferWizard.jsx';
import OffersList from './pages/OffersList.jsx';

function Protected({ children }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="full-loading">Lade…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function AdminOnly({ children }) {
  const { me, isAdmin } = useAuth();
  if (!me) return <div className="full-loading">Lade…</div>;
  if (!isAdmin) return <Navigate to="/kunden" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-passwort" element={<ResetPassword />} />
      <Route path="/upload/:token" element={<PublicUpload />} />
      <Route path="/formular/:token" element={<PublicFormular />} />
      <Route path="/f/:funnelId" element={<PublicFunnel />} />
      <Route path="/review/:token" element={<PublicReview />} />
      <Route path="/bewerbungen/:token" element={<PublicBewerbungen />} />
      <Route path="/anfragen/:token" element={<PublicAnfragen />} />
      <Route path="/portal/:token" element={<PublicPortal />} />
      <Route path="/avv/:token" element={<PublicAvv />} />
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
        <Route path="bewerbungen" element={<BewerbungenOverview />} />
        <Route path="zahlungen" element={<ZahlungenOverview />} />
        <Route path="projekte" element={<ProjekteOverview />} />
        <Route path="live-kampagnen" element={<LiveKampagnen />} />
        <Route path="analyse-funnel" element={<AnalyseFunnel />} />
        <Route path="angebote" element={<OffersList />} />
        <Route path="angebote/neu" element={<OfferWizard />} />
        <Route path="admin/angebots-katalog" element={<AdminOnly><OfferKatalog /></AdminOnly>} />
        <Route path="admin/stilvorlagen" element={<AdminOnly><StilvorlagenAdmin /></AdminOnly>} />
        <Route path="admin/eigene-leads" element={<AdminOnly><EigeneLeads /></AdminOnly>} />
        <Route path="controlling" element={<ControllingDashboard />} />
        <Route path="admin/controlling" element={<AdminOnly><Controlling /></AdminOnly>} />
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
