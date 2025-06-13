const { Client, MessageMedia, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const ExcelJS = require("exceljs");

new Client({
  authStrategy: new LocalAuth(), // Simpan sesi login secara lokal
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"], // ✅ Fix error root user
    headless: true,
  },
});

const DATA_FILE = "./data.json";
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");

// Utilitas
function generateId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function findEntryById(id) {
  const data = loadData();
  const index = data.findIndex((d) => d.id === id);
  return { data, index, entry: data[index] };
}

function formatRekap(data, title) {
  let msg = `${title}\n=================\n`;
  data.forEach((d) => {
    msg += `🆔 ${d.id}\n📌 ${d.line} | ${d.produk}\n🕒 ${d.mulai}–${d.selesai} | Qty: ${d.qty}\n👤 ${d.operator}\n\n`;
  });
  return msg;
}

async function exportToExcel(data, path) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Rekap");

  sheet.columns = [
    { header: "ID", key: "id" },
    { header: "Tanggal", key: "tanggal" },
    { header: "Line", key: "line" },
    { header: "Produk", key: "produk" },
    { header: "Mulai", key: "mulai" },
    { header: "Selesai", key: "selesai" },
    { header: "Qty", key: "qty" },
    { header: "Operator", key: "operator" },
  ];

  data.forEach((d) => sheet.addRow(d));
  await workbook.xlsx.writeFile(path);
}

// Cek apakah pengirim adalah admin grup
async function isAdminInGroup(msg) {
  if (!msg.from.endsWith("@g.us")) return true; // Private chat = diizinkan
  const chat = await msg.getChat();
  const authorId = msg.author || msg.from;
  const isAdmin = chat.participants.find(
    (p) => p.id._serialized === authorId && p.isAdmin
  );
  return !!isAdmin;
}

const client = new Client({ authStrategy: new LocalAuth() });

client.on("qr", (qr) => qrcode.generate(qr, { small: true }));
client.on("ready", () => console.log("✅ Bot is ready!"));

client.on("message", async (msg) => {
  const text = msg.body.trim();
  const sender = msg.from;

  // Input data
  if (text.startsWith("!line")) {
    if (!(await isAdminInGroup(msg))) {
      return msg.reply("🚫 Hanya admin grup yang dapat input data.");
    }

    const [prefix, produk, mulai, selesai, qty] = text.split(" ");
    if (!produk || !mulai || !selesai || !qty) {
      return msg.reply(
        "❌ Format salah. Contoh:\n!line1 BotolA 08:00 12:00 500"
      );
    }

    const entry = {
      id: generateId(),
      tanggal: new Date().toISOString().slice(0, 10),
      waktu: new Date().toISOString(),
      line: prefix.slice(1),
      produk,
      mulai,
      selesai,
      qty: parseInt(qty),
      operator: msg.author || sender,
    };

    const data = loadData();
    data.push(entry);
    saveData(data);
    return msg.reply(
      `✅ Data ${entry.line} disimpan: ${produk}, ${qty} unit\n🆔 ID: ${entry.id}`
    );
  }

  // Ubah data
  if (text.startsWith("!ubah")) {
    if (!(await isAdminInGroup(msg))) {
      return msg.reply("🚫 Hanya admin grup yang dapat mengubah data.");
    }

    const parts = text.split(" ");
    if (parts.length < 7) {
      return msg.reply(
        "❌ Format salah.\nContoh:\n!ubah 7GHD21 line1 BotolB 09:00 13:00 600"
      );
    }

    const [, id, line, produk, mulai, selesai, qtyStr] = parts;
    const qtyBaru = parseInt(qtyStr);
    if (isNaN(qtyBaru)) return msg.reply("❌ Qty harus berupa angka.");

    const { data, index, entry } = findEntryById(id);
    if (index === -1)
      return msg.reply(`⚠️ Data dengan ID ${id} tidak ditemukan.`);

    entry.line = line.replace("line", "");
    entry.produk = produk;
    entry.mulai = mulai;
    entry.selesai = selesai;
    entry.qty = qtyBaru;

    saveData(data);
    return msg.reply(`✏️ Data pada ID ${id} berhasil diubah:
📌 Line: ${entry.line}
📦 Produk: ${entry.produk}
🕒 Jam: ${entry.mulai}–${entry.selesai}
🔢 Qty: ${entry.qty}`);
  }

  // Hapus data
  if (text.startsWith("!hapus")) {
    if (!(await isAdminInGroup(msg))) {
      return msg.reply("🚫 Hanya admin grup yang dapat menghapus data.");
    }

    const [cmd, id] = text.split(" ");
    if (!id) return msg.reply("❌ Gunakan: !hapus ABC123");

    const { data, index, entry } = findEntryById(id);
    if (index === -1)
      return msg.reply(`⚠️ Data dengan ID ${id} tidak ditemukan.`);

    data.splice(index, 1);
    saveData(data);
    return msg.reply(
      `🗑️ Data dengan ID ${id} (${entry.line} - ${entry.produk}) berhasil dihapus.`
    );
  }

  // Rekap harian
  if (text.startsWith("!rekap hari")) {
    const [, , input] = text.split(" ");
    const tanggal = input
      ? input.split("-").reverse().join("-")
      : new Date().toISOString().slice(0, 10);
    const data = loadData().filter((d) => d.tanggal === tanggal);
    if (!data.length) return msg.reply(`📭 Tidak ada data pada ${tanggal}`);
    return msg.reply(formatRekap(data, `📅 Rekap Harian (${tanggal})`));
  }

  // Rekap bulanan
  if (text.startsWith("!rekap bulan")) {
    const [, , input] = text.split(" ");
    const bulan = input || new Date().toISOString().slice(0, 7);
    const data = loadData().filter((d) => d.tanggal.startsWith(bulan));
    if (!data.length) return msg.reply(`📭 Tidak ada data bulan ${bulan}`);
    return msg.reply(formatRekap(data, `🗓️ Rekap Bulanan (${bulan})`));
  }

  // Rekap jam (hari ini)
  if (text === "!rekap jam") {
    const today = new Date().toISOString().slice(0, 10);
    const data = loadData().filter((d) => d.tanggal === today);
    if (!data.length) return msg.reply("📭 Tidak ada data hari ini.");

    let msgText = `🕒 *Rekap Jam (${today})*\n`;
    data.forEach((d) => {
      msgText += `• ${d.line} - ${d.produk}: ${d.mulai}–${d.selesai} → ${d.qty} unit\n`;
    });
    return msg.reply(msgText);
  }

  // Export ke Excel
  if (text.startsWith("!export")) {
    const [cmd, mode, arg] = text.split(" ");
    const tanggal = arg
      ? mode === "hari"
        ? arg.split("-").reverse().join("-")
        : arg
      : mode === "hari"
      ? new Date().toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 7);
    const data = loadData().filter((d) =>
      mode === "hari" ? d.tanggal === tanggal : d.tanggal.startsWith(tanggal)
    );

    if (!data.length) return msg.reply(`📭 Tidak ada data untuk ${tanggal}`);

    const path = `./exports/Rekap-${tanggal}.xlsx`;
    if (!fs.existsSync("./exports")) fs.mkdirSync("./exports");
    await exportToExcel(data, path);
    await msg.reply(`📤 File Excel untuk ${tanggal}`);
    await client.sendMessage(sender, MessageMedia.fromFilePath(path), {
      caption: `📦 Rekap Produksi (${tanggal})`,
    });
  }
});

client.initialize();
