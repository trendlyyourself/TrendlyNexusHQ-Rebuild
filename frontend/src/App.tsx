import "./App.css";
import { useState } from "react";
import Register from "./pages/Register";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";

function App() {
  const [page, setPage] = useState("home");

  return (
    <div className="app">

      <header className="navbar">
        <div className="logo">
          Al's Life-size Toys
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

          <button onClick={() => setPage("dashboard")}>
            Member Portal
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
              Al's Life-size Toys powered by
              Trendly Yourself Automation Engine.
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

      {page === "dashboard" && (
        <Dashboard />
      )}

    </div>
  );
}

export default App;
