import "./App.css";
import { useState } from "react";
import Register from "./pages/Register";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
function App() {

const [page, setPage] = useState(
  window.location.pathname === "/reset-password"
    ? "reset"
    : "home"
);
  return (
    <div className="app">

      <header className="navbar">
        <div className="logo">
          Trendly Nexus HQ
        </div>

        <nav>
          <button onClick={() => setPage("home")}>
            Home
          </button>

          <button onClick={() => setPage("login")}>
            Login
          </button>

          <button onClick={() => setPage("register")}>
            Register
          </button>

          <button onClick={() => setPage("forgot")}>
            Forgot Password
          </button>

          <button onClick={() => setPage("dashboard")}>
            Member Portal
          </button>
<button onClick={() => setPage("reset")}>
  Reset Password
</button>
        </nav>
      </header>

      {page === "home" && (
        <section className="hero">
          <div className="hero-text">
            <h1>
              Intelligent Collectibles.
              <br />
              Automated Experiences.
            </h1>

            <p>
              Trendly Nexus HQ powered by
              Trendly Nexus HQ Automation Engine.
            </p>
          </div>
        </section>
      )}

      {page === "login" && (
        <Login />
      )}

      {page === "register" && (
        <Register />
      )}

      {page === "forgot" && (
        <ForgotPassword />
      )}

      {page === "dashboard" && (
        <Dashboard />
      )}
{page === "reset" && (
  <ResetPassword />
)}
    </div>
  );
}

export default App;
