import { useState } from "react";
import { resetPassword } from "../api/client";

export default function ResetPassword() {
  const params = new URLSearchParams(
    window.location.search
  );

  const email = params.get("email") || "";
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    try {
      const res = await resetPassword(
        email,
        token,
        password
      );

      setMessage(res.data.message);
    } catch {
      setMessage("Password reset failed");
    }
  }

  return (
    <div>
      <h2>Reset Password</h2>

      <form onSubmit={submit}>
        <input
          type="password"
          placeholder="New Password"
          value={password}
          onChange={(e) =>
            setPassword(e.target.value)
          }
        />

        <button type="submit">
          Update Password
        </button>
      </form>

      <p>{message}</p>
    </div>
  );
}
