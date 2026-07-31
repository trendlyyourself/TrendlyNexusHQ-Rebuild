import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:3000",
});

export default api;

export async function forgotPassword(email: string) {
  return api.post("/auth/forgot-password", {
    email,
  });
}

export async function resetPassword(
  email: string,
  token: string,
  newPassword: string
) {
  return api.post("/auth/reset-password", {
    email,
    token,
    newPassword,
  });
}

export async function loginWithPasskey() {
  return api.post("/auth/passkey/login");
}

export async function registerPasskey() {
  return api.post("/auth/passkey/register");
}
