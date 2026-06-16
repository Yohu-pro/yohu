import { google } from "googleapis";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { sheetId } = req.body;
    
    if (!sheetId) {
      return res.status(400).json({ error: "Thiếu sheetId" });
    }

    const serviceAccount = JSON.parse(
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "{}"
    );

    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "A1:Z1000",
    });

    res.json({ data: response.data.values || [] });
  } catch (error) {
    console.error("Sheets fetch error:", error);
    res.status(500).json({ error: error.message });
  }
}
