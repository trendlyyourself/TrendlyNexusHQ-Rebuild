import { useEffect, useState } from "react";
import api from "../api/client";

function Dashboard() {
  const [projects, setProjects] = useState<any[]>([]);

  useEffect(() => {
    async function loadProjects() {
      try {
        const token = localStorage.getItem("token");

        const response = await api.get("/projects", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        setProjects(response.data);
      } catch (error) {
        console.log("Dashboard loading failed");
      }
    }

    loadProjects();
  }, []);

  return (
    <div>
      <h1>
        Al's Life-size Toys Member Portal
      </h1>

      <p>
        Powered by Trendly Yourself Automation Engine
      </p>

      <section>
        <h2>Your Projects</h2>

        {projects.length === 0 ? (
          <p>No projects yet.</p>
        ) : (
          projects.map((project) => (
            <div key={project.id}>
              <h3>{project.title}</h3>
              <p>{project.description}</p>
              <small>Status: {project.status}</small>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

export default Dashboard;
