import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState, lazy, Suspense } from "react";
import AuthPage from "./pages/AuthPage";
import ChatLayout from "./pages/ChatLayout";
import ProtectedRoute from "./components/ProtectedRoute";

// 周报页带着 ECharts，按需加载，避免拖慢对话首屏
const ReportPage = lazy(() => import("./pages/ReportPage"));

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token"));

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<AuthPage setToken={setToken} />} />

        <Route
          path="/chat"
          element={
            <ProtectedRoute>
              <ChatLayout />
            </ProtectedRoute>
          }
        />

        <Route
          path="/report"
          element={
            <ProtectedRoute>
              <Suspense
                fallback={
                  <div className="min-h-screen bg-stone-950 text-stone-400 text-sm flex items-center justify-center">
                    正在打开周报…
                  </div>
                }
              >
                <ReportPage />
              </Suspense>
            </ProtectedRoute>
          }
        />

        <Route
          path="*"
          element={
            token ? <Navigate to="/chat" /> : <Navigate to="/auth" />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
