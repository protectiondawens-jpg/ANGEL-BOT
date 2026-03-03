const os = require("os")

module.exports = async (conn, m) => {

    if (!m.command) return

    /* ===== COOLDOWN CHECK ===== */
    if (m.cooldown && m.cooldown()) {
        return m.reply("⏳ Tanpri tann 3 segond avan ou re-eseye.")
    }

    switch (m.command) {

        /* ================= MENU ================= */
        case "menu": {
            let teks = `
╔═══〔 🤖 ANGEL-X MENU 〕═══╗
║
║ 👑 Owner Commands
║   • .owner
║
║ ⚡ General Commands
║   • .ping
║   • .menu
║   • .alive
║
╚═══════════════════════╝
`
            m.react("⚡")
            return m.reply(teks)
        }

        /* ================= PING ================= */
        case "ping": {
            const start = Date.now()
            await m.reply("🏓 Testing...")
            const speed = Date.now() - start
            return m.reply(`⚡ Speed: ${speed}ms`)
        }

        /* ================= ALIVE ================= */
        case "alive": {
            const uptime = process.uptime()
            const ram = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)
            return m.reply(
`🤖 *ANGEL-X ACTIVE*

⏳ Uptime: ${Math.floor(uptime)} sec
💾 RAM Used: ${ram} MB
🖥 Platform: ${os.platform()}
`
            )
        }

        /* ================= OWNER ================= */
        case "owner": {
            if (!m.isOwner) {
                return m.reply("❌ Command sa se pou owner sèlman.")
            }

            return m.reply("👑 Bonjou Boss Angel 😎")
        }

        /* ================= GROUP ONLY ================= */
        case "ginfo": {
            if (!m.isGroup) {
                return m.reply("❌ Command sa mache nan group sèlman.")
            }

            return m.reply(`👥 Group ID:\n${m.chat}`)
        }

        /* ================= REACT TEST ================= */
        case "love": {
            m.react("❤️")
            return m.reply("Love detected 😈")
        }

        default:
            return
    }
}