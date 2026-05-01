const { dashboardData } = require("../lib/dashboard-data");

module.exports = async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    const data = await dashboardData(req.query?.refresh === "1");
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
