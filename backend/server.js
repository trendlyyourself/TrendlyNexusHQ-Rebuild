const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "TrendlyNexusHQ API"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TrendlyNexusHQ API running on port ${PORT}`);
});
