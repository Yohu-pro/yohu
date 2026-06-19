import { GoogleGenAI } from "@google/genai";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { PRODUCTS } from "./products-data.js";

function initFirebase() {
  if (!getApps().length) {
    const serviceAccount = JSON.parse(
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "{}"
    );
    initializeApp({
      credential: cert(serviceAccount),
      projectId: "gen-lang-client-0466013290",
    });
  }
  return getFirestore("ai-studio-879b6d96-172d-42d2-8081-c896c1489128");
}

const DEFAULT_CONFIG = {
  company_name: "Công ty TNHH Yohu Việt Nam",
  address: "BT39 Khu Biệt thự Tân Phố Hiến – phường Phố Hiến – tỉnh Hưng Yên",
  hotline: "+84 973 480 488",
  zalo: "+84 339 60 69 69",
  email_primary: "yohu.vn@gmail.com",
  email_secondary: "yohu.com.vn@gmail.com",
  gemini_api_key: "",
  gemini_model: "gemini-2.5-flash",
  bot_knowledge: "",
  custom_products: [],
};

async function readConfig() {
  try {
    const db = initFirebase();
    const doc = await db.collection("settings").doc("appConfig").get();
    if (doc.exists) {
      return { ...DEFAULT_CONFIG, ...doc.data() };
    }
  } catch (error) {
    console.error("readConfig error:", error);
  }
  return DEFAULT_CONFIG;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const { message, apiKey } = typeof body === "string" ? JSON.parse(body) : body;
    const config = await readConfig();

    const candidateKeys = [];

    if (config.gemini_api_key && config.gemini_api_key.trim()) {
      config.gemini_api_key.split(",").forEach((k) => {
        const key = k.trim();
        if (key && !candidateKeys.includes(key)) candidateKeys.push(key);
      });
    }

    if (apiKey && apiKey.trim()) {
      apiKey.split(",").forEach((k) => {
        const key = k.trim();
        if (key && !candidateKeys.includes(key)) candidateKeys.push(key);
      });
    }

    if (process.env.GEMINI_API_KEYS) {
      process.env.GEMINI_API_KEYS.split(",").forEach((k) => {
        const key = k.trim();
        if (key && !candidateKeys.includes(key)) candidateKeys.push(key);
      });
    }

    if (process.env.GEMINI_API_KEY) {
      process.env.GEMINI_API_KEY.split(",").forEach((k) => {
        const key = k.trim();
        if (key && !candidateKeys.includes(key)) candidateKeys.push(key);
      });
    }

    if (candidateKeys.length === 0) {
      return res.status(400).json({
        error: "Vui lòng cấu hình Gemini API Key để sử dụng Chatbot.",
      });
    }

    const msgLower = (message || "").toLowerCase().trim();
    const nonAccentMsg = msgLower
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    const generalKeywords = [
      "chao", "xin chao", "hello", "hi", "helo", "ban oi", "admin oi",
      "ad oi", "co ai ko", "co ai khong", "bat dau", "start", "huong dan",
      "tro giup", "help", "yohu", "yohu viet nam",
    ];

    const isGeneral =
      !msgLower ||
      generalKeywords.some((k) => nonAccentMsg === k);

    if (isGeneral) {
      return res.json({
        text: `Xin chào! Tôi là Trợ lý tư vấn Yohu Việt Nam 👋
Tôi có thể giúp bạn:

- Tư vấn chọn sản phẩm phù hợp (điều hòa, bồn nước, năng lượng mặt trời, thiết bị vệ sinh, thiết bị bếp...)
- Tra cứu giá, thông số kỹ thuật
- Hướng dẫn đặt hàng và chính sách bảo hành

Bạn cần hỗ trợ gì hôm nay?`,
      });
    }

    const customProducts = config.custom_products || [];
    const consolidatedProducts = [...PRODUCTS, ...customProducts];
    const productSummary = consolidatedProducts
      .map((p) => `- Mã: ${p.id} | ${p.name}: ${p.price}${p.oldPrice ? ` (giá cũ: ${p.oldPrice})` : ""} | Danh mục: ${p.category}${p.brand ? ` | Hãng: ${p.brand}` : ""}`)
      .join("\n");

    const prompt = `Bạn là trợ lý AI thông minh cho ${config.company_name}.
Thông tin công ty:
- Địa chỉ: ${config.address}
- Hotline: ${config.hotline}
- Zalo: ${config.zalo}

DANH SÁCH SẢN PHẨM ĐẦY ĐỦ (mã, tên, giá, danh mục):
${productSummary || "Chưa có dữ liệu sản phẩm."}

Kiến thức bổ trợ (bảng giá/catalogue):
${config.bot_knowledge || "Không có."}

HƯỚNG DẪN TRẢ LỜI:
1. Khi khách hỏi về sản phẩm, giá, hoặc mã hàng — LUÔN tra cứu chính xác trong DANH SÁCH SẢN PHẨM ở trên trước khi trả lời.
2. Nếu tìm thấy sản phẩm khớp, trả lời kèm: tên đầy đủ, mã sản phẩm, giá (và giá cũ nếu có khuyến mãi).
3. Nếu khách hỏi mã hàng cụ thể mà không có trong danh sách, hãy nói rõ chưa có thông tin và đề nghị liên hệ Hotline/Zalo để được tư vấn chi tiết.
4. Trả lời chuyên nghiệp, thân thiện, súc tích bằng tiếng Việt.

Câu hỏi của khách: ${message}`;

    const modelsToTry = [
      config.gemini_model?.trim() || "gemini-2.5-flash",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
    ];

    let result = null;

    for (const currentKey of candidateKeys) {
      for (const currentModel of modelsToTry) {
        try {
          const ai = new GoogleGenAI({ apiKey: currentKey });
          const response = await ai.models.generateContent({
            model: currentModel,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
          });
          result = response;
          break;
        } catch (err) {
          console.error(`Chat error with model ${currentModel}:`, err.message);
        }
      }
      if (result) break;
    }

    if (!result) {
      return res.status(500).json({
        error: "Hệ thống chatbot đang bận. Vui lòng thử lại sau hoặc liên hệ Hotline.",
      });
    }

    res.json({ text: result.text });
  } catch (error) {
    console.error("Chat handler error:", error);
    res.status(500).json({
      error: "Có lỗi kỹ thuật. Vui lòng liên hệ Hotline.",
    });
  }
}
