import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Overview from './pages/Overview.jsx'
import Alerts from './pages/Alerts.jsx'
import Tickets from './pages/Tickets.jsx'
import Insights from './pages/Insights.jsx'
import Reports from './pages/Reports.jsx'
import Import from './pages/Import.jsx'
import Tech from './pages/Tech.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Mobile technician view: no sidebar (built in H3) */}
        <Route path="/tech" element={<Tech />} />
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="tickets" element={<Tickets />} />
          <Route path="insights" element={<Insights />} />
          <Route path="reports" element={<Reports />} />
          <Route path="import" element={<Import />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
