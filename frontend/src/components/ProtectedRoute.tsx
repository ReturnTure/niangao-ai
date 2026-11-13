import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";

export interface ProtectedRouteProps {
  children: ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const token = localStorage.getItem("token");

  if (!token) {
    return <Navigate to="/auth?mode=login" replace />;
  }

  return children;
}
