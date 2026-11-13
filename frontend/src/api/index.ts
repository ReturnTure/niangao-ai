import axios, { AxiosError, AxiosInstance, AxiosPromise, InternalAxiosRequestConfig } from "axios";
import { API_URL } from "./config";

// ---------------- AXIOS INSTANCE ---------------- //

const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 15000,
});

// 排队等待刷新完成的请求
type Subscriber = {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
};

// 401 后重新发出的请求，需要记住「已经重试过一次」
interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

// 🔐 Refresh state
let isRefreshing = false;
let subscribers: Subscriber[] = [];

// ✅ Resolve queued requests
function onRefreshed(token: string): void {
  subscribers.forEach((cb) => cb.resolve(token));
  subscribers = [];
}

// ❌ Reject queued requests
function onFailed(error: unknown): void {
  subscribers.forEach((cb) => cb.reject(error));
  subscribers = [];
}

function addSubscriber(resolve: (token: string) => void, reject: (error: unknown) => void): void {
  subscribers.push({ resolve, reject });
}

// ---------------- REQUEST INTERCEPTOR ---------------- //

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// ---------------- RESPONSE INTERCEPTOR ---------------- //

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetriableRequestConfig;

    // ❌ No response → server/network issue
    if (!error.response) {
      return Promise.reject(error);
    }

    // ❌ Prevent infinite loop
    if (
      // url 在类型上是可选的（axios 允许从 baseURL 拼接），这里按「没有 url」处理
      originalRequest.url?.includes("/auth/refresh") ||
      originalRequest._retry
    ) {
      logoutUser();
      return Promise.reject(error);
    }

    // 🔁 Token expired
    if (error.response.status === 401) {
      if (isRefreshing) {
        return new Promise<unknown>((resolve, reject) => {
          addSubscriber(
            (token) => {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              resolve(api(originalRequest));
            },
            (err) => reject(err)
          );
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = localStorage.getItem("refresh_token");
        if (!refreshToken) throw new Error("No refresh token");

        const res = await axios.post(
          `${API_URL}/auth/refresh`,
          {},
          {
            headers: {
              Authorization: `Bearer ${refreshToken}`,
            },
          }
        );

        const newAccess = res.data.access_token;
        const newRefresh = res.data.refresh_token;

        // ✅ Store new tokens
        localStorage.setItem("token", newAccess);
        localStorage.setItem("refresh_token", newRefresh);

        // ✅ Resolve all queued requests
        onRefreshed(newAccess);

        // ✅ Retry original request
        originalRequest.headers.Authorization = `Bearer ${newAccess}`;
        return api(originalRequest);

      } catch (err) {
        // ❌ Reject all queued requests
        onFailed(err);

        logoutUser();
        return Promise.reject(err);

      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// ---------------- AUTH APIs ---------------- //

export interface RegisterPayload {
  email: string;
  password: string;
  name?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  [key: string]: unknown;
}

export const registerUser = (data: RegisterPayload): AxiosPromise =>
  api.post("/auth/register", data);

export const loginUser = async (data: LoginPayload): Promise<AuthResponse> => {
  const res = await api.post("/auth/login", data);

  localStorage.setItem("token", res.data.access_token);
  localStorage.setItem("refresh_token", res.data.refresh_token);

  return res.data;
};

export const logoutUser = (): void => {
  localStorage.clear();

  // ✅ Prevent multiple redirects spam
  if (window.location.pathname !== "/auth") {
    window.location.href = "/auth";
  }
};

// ---------------- CHAT APIs ---------------- //

export const sendMessage = (message: string): AxiosPromise =>
  api.post("/chat/", { message });

export const getChatHistory = (): AxiosPromise =>
  api.get("/chat/history");

export default api;
