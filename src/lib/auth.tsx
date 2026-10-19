import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

type Admin = { id: string; username: string };
type AuthCtx = {
  admin: Admin | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<Admin>("/api/auth/me")
      .then(setAdmin)
      .catch(() => setAdmin(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    setAdmin(await api.post<Admin>("/api/auth/login", { username, password }));
  };
  const logout = async () => {
    await api.post("/api/auth/logout");
    setAdmin(null);
  };

  return <Ctx.Provider value={{ admin, loading, login, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
