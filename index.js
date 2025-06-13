const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const ExcelJS = require('exceljs');

const DATA_FILE = './data.json';
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
if (!fs.existsSync('./exports')) fs.mkdirSync('./exports');

function loadData() {
    return JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function formatRekap(data, title) {
    let msg = `${title}\n=================\n`;
    data.forEach(d => {
        msg += `📌 ${d.line} | ${d.produk}\n🕒 ${d.mulai}–${d.selesai} | Qty: ${d.qty}\n👤 ${d.operator}\n\n`;
    });
    return msg;
}

async function exportToExcel(data, path) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Rekap Produksi');
    ws.columns = [
        { header: 'Tanggal', key: 'tanggal', width: 15 },
        { header: 'Line', key: 'line', width: 10 },
        { header: 'Produk', key: 'produk', width: 20 },
        { header: 'Mulai', key: 'mulai', width: 10 },
        { header: 'Selesai', key: 'selesai', width: 10 },
        { header: 'Qty', key: 'qty', width: 10 },
        { header: 'Operator', key: 'operator', width: 25 }
    ];
    data.forEach(row => ws.addRow(row));
    await wb.xlsx.writeFile(path);
}

const client = new Client({ authStrategy: new LocalAuth() });

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('✅ Bot is ready!'));

client.on('message', async msg => {
    const text = msg.body.trim();
    const sender = msg.from;

    // INPUT DATA – hanya admin grup
    if (text.startsWith('!line')) {
        const chat = await msg.getChat();
        const isGroup = chat.isGroup;

        // Cek admin jika di grup
        if (isGroup) {
            const authorId = msg.author;
            const author = chat.participants.find(p => p.id._serialized === authorId);
            if (!author?.isAdmin) {
                return msg.reply('⛔ Hanya admin grup yang bisa input data produksi.');
            }
        }

        const [prefix, produk, mulai, selesai, qty] = text.split(' ');
        if (!produk || !mulai || !selesai || !qty) {
            return msg.reply('❌ Format salah. Contoh:\n!line1 BotolA 08:00 12:00 500');
        }

        const entry = {
            tanggal: new Date().toISOString().slice(0, 10),
            line: prefix.slice(1),
            produk,
            mulai,
            selesai,
            qty: parseInt(qty),
            operator: msg.author || sender
        };

        const data = loadData();
        data.push(entry);
        saveData(data);
        return msg.reply(`✅ Data ${entry.line} disimpan: ${produk}, ${qty} unit`);
    }

    // REKAP HARI
    if (text.startsWith('!rekap hari')) {
        const [, , input] = text.split(' ');
        const tanggal = input ? input.split('-').reverse().join('-') : new Date().toISOString().slice(0, 10);
        const data = loadData().filter(d => d.tanggal === tanggal);
        if (!data.length) return msg.reply(`📭 Tidak ada data pada ${tanggal}`);
        return msg.reply(formatRekap(data, `📅 Rekap Harian (${tanggal})`));
    }

    // REKAP BULAN
    if (text.startsWith('!rekap bulan')) {
        const [, , input] = text.split(' ');
        const bulan = input || new Date().toISOString().slice(0, 7);
        const data = loadData().filter(d => d.tanggal.startsWith(bulan));
        if (!data.length) return msg.reply(`📭 Tidak ada data bulan ${bulan}`);
        return msg.reply(formatRekap(data, `🗓️ Rekap Bulanan (${bulan})`));
    }

    // REKAP JAM
    if (text === '!rekap jam') {
        const today = new Date().toISOString().slice(0, 10);
        const data = loadData().filter(d => d.tanggal === today);
        if (!data.length) return msg.reply('📭 Tidak ada data hari ini.');
        let msgText = `🕒 *Rekap Jam (${today})*\n`;
        data.forEach(d => {
            msgText += `• ${d.line} - ${d.produk}: ${d.mulai}–${d.selesai} → ${d.qty} unit\n`;
        });
        return msg.reply(msgText);
    }

    // EXPORT EXCEL
    if (text.startsWith('!export')) {
        const [cmd, mode, arg] = text.split(' ');
        const tanggal = arg ? (mode === 'hari' ? arg.split('-').reverse().join('-') : arg) :
            (mode === 'hari' ? new Date().toISOString().slice(0, 10) : new Date().toISOString().slice(0, 7));

        const data = loadData().filter(d =>
            mode === 'hari' ? d.tanggal === tanggal : d.tanggal.startsWith(tanggal)
        );

        if (!data.length) return msg.reply(`📭 Tidak ada data untuk ${tanggal}`);

        const path = `./exports/Rekap-${tanggal}.xlsx`;
        await exportToExcel(data, path);
        await msg.reply(`📤 File Excel untuk ${tanggal}`);
        await client.sendMessage(sender, MessageMedia.fromFilePath(path), {
            caption: `📦 Rekap Produksi (${tanggal})`
        });
    }
});

client.initialize();
