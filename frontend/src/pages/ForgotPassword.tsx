import { useState } from "react";
import { forgotPassword } from "../api/client";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    try {
      const res = await forgotPassword(email);
      setMessage(res.data.message);
    } catch {
      setMessage("Unable to process request");
    }
  }

  return (
    <div>
      <h2>Forgot Password</h2>

      <form onSubmit={submit}>
        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <button type="submit">
          Send Reset Link
        </button>
      </form>

      <p>{message}</p>
    </div>
  );
}
