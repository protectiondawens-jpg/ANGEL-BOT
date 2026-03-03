// =======================================
//        ANGEL XD - POWERED BY ANGEL TECH
// =======================================

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const fs = require("fs");

async function startAngelBot() {

  const { state, saveCreds } = await useMultiFileAuthState("./session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: true,
    auth: state,
    browser: ["ANGEL XD", "Chrome", "1.0.0"]
  });

  // ==============================
  // CONNECT SYSTEM
  // ==============================

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log("❌ Connection closed.");

      if (shouldReconnect) {
        console.log("🔄 Reconnecting...");
        startAngelBot();
      } else {
        console.log("⚠️ Logged out. Delete session folder and scan again.");
      }
    }

    if (connection === "open") {
      console.log(`
╔══════════════════════════════╗
   👑 ANGEL XD CONNECTED 👑
   ⚡ Powered by ANGEL TECH ⚡
╚══════════════════════════════╝
      `);
    }
  });

  // ==============================
  // SAVE SESSION
  // ==============================

  sock.ev.on("creds.update", saveCreds);

  // ==============================
  // MESSAGE SYSTEM
  // ==============================

  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    if (!msg.message) return;
    if (msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const body =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    console.log("📩 Message:", body);

    // SIMPLE COMMAND SYSTEM
    if (body.toLowerCase() === "!ping") {
      await sock.sendMessage(from, { text: "🏓 Pong! ANGEL XD is alive 👑" });
    }

    if (body.toLowerCase() === "!menu") {
      await sock.sendMessage(from, {
        text: `
╔═══〔 👑 ANGEL XD MENU 👑 〕═══╗
│
│ ⚡ !ping
│ 📜 !menu
│
╚══════════════════════════════╝
        `
      });
    }
  });
}

// START BOT
startAngelBot();