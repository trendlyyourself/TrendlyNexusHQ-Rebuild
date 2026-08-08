import { useState } from "react";
import api from "../api/client";

function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function register() {
    try {
      const response = await api.post("/auth/register", {
        email,
        password,
      });

      alert(response.data.message);
    } catch (error) {
      alert("Registration failed");
    }
  }

  return (
    <div>
      <h1>Create Trendly Nexus HQ Account</h1>

      <input
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <input
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <button onClick={register}>
        Create Account
      </button>
    </div>
  );
}

export default Register;
