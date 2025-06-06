// Impor library yang diperlukan
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
} = require("@whiskeysockets/baileys");
const express = require("express"); // Tambahkan Express
const axios = require("axios");
const pino = require("pino");
const qrcode = require("qrcode-terminal");

// --- Konfigurasi ---
// URL webhook n8n Anda. Pastikan ini URL PRODUKSI, bukan TEST.
const WEBHOOK_URL = "https://n8n-gcvesmgr.ap-southeast-1.clawcloudrun.com/webhook-test/whatsapp-bot";
// Port untuk API yang akan dipanggil oleh n8n untuk mengirim balasan
const API_PORT = 3000;

async function startBot() {
    // Menggunakan kode otentikasi dan logger Anda
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        printQRInTerminal: true
    });

    sock.ev.on("creds.update", saveCreds);

    // Menggunakan logika koneksi Anda yang sudah bagus
    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("Scan QR code di bawah untuk login:");
            qrcode.generate(qr, { small: true });
        }
        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                console.log("❌ Logged out. Hapus folder auth_info untuk login ulang.");
            } else {
                console.log("🔄 Koneksi terputus, mencoba menghubungkan kembali...");
                startBot();
            }
        } else if (connection === "open") {
            console.log("✅ Bot WhatsApp aktif dan terhubung!");
        }
    });

    // BAGIAN 1: MENERIMA PESAN DARI WA & MENGIRIM KE N8N (Logika Anda yang Diperbaiki)
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const text = msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption || "";

        if (!text) return; // Abaikan pesan tanpa teks

        console.log(`📩 Pesan masuk dari ${sender}: ${text}`);

        try {
            // KIRIM KE N8N: Hanya mengirim data ke webhook.
            // Logika untuk mengirim balasan dihapus dari sini.
            await axios.post(WEBHOOK_URL, {
                sender: sender,
                message: text,
                timestamp: msg.messageTimestamp,
                messageId: msg.key.id
            });
            console.log("✅ Pesan diteruskan ke webhook n8n");
        } catch (err) {
            console.error("❌ Gagal mengirim pesan ke webhook n8n:");
            console.error(err.response?.data || err.message);
        }
    });

    return sock; // Mengembalikan instance 'sock' agar bisa digunakan oleh API server
}

// BAGIAN 2: MEMBUAT API SERVER UNTUK MENERIMA PERINTAH DARI N8N
// Fungsi ini akan berjalan setelah bot berhasil terhubung.
startBot().then(sock => {
    const app = express();
    app.use(express.json());

    // Endpoint ini yang akan dipanggil oleh n8n untuk mengirim balasan
    app.post('/send-message', async (req, res) => {
        const { to, message } = req.body;

        if (!to || !message) {
            return res.status(400).json({ error: 'Parameter "to" dan "message" diperlukan.' });
        }

        try {
            // Menggunakan 'sock' yang aktif untuk mengirim pesan balasan
            await sock.sendMessage(to, { text: message });
            console.log(`✔️ Balasan terkirim ke ${to}: ${message}`);
            res.status(200).json({ success: true, message: 'Pesan berhasil dikirim.' });
        } catch (error) {
            console.error('❌ Gagal mengirim pesan balasan dari API:', error);
            res.status(500).json({ success: false, error: 'Gagal mengirim pesan.' });
        }
    });

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
    console.log(`🚀 Server API untuk n8n berjalan di port ${PORT}`);
});

}).catch(err => {
    console.error("Gagal memulai bot:", err);
});
