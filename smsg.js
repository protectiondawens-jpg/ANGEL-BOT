const {
    proto,
    downloadContentFromMessage,
    getContentType
} = require('baileys')

const fs = require('fs')
const path = require('path')

const BOT_NAME = "ANGEL-X"
const BOT_BRAND = "Angel Tech 2026"

/* ================= MEDIA DOWNLOADER (OPTIMIZED) ================= */

const downloadMediaMessage = async (m, filename = 'file') => {
    try {
        let type = m.type === 'viewOnceMessage' ? m.msg.type : m.type
        const message = m.msg

        const stream = await downloadContentFromMessage(message, type.replace('Message', ''))
        let buffer = Buffer.from([])

        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }

        let ext = ''

        if (type === 'imageMessage') ext = '.jpg'
        else if (type === 'videoMessage') ext = '.mp4'
        else if (type === 'audioMessage') ext = '.mp3'
        else if (type === 'stickerMessage') ext = '.webp'
        else if (type === 'documentMessage') {
            ext = path.extname(message.fileName || '') || '.bin'
        }

        const filePath = filename + ext
        fs.writeFileSync(filePath, buffer)

        return buffer

    } catch (err) {
        console.log('Download error:', err)
        return null
    }
}

/* ================= MESSAGE SERIALIZER ================= */

const sms = (conn, m) => {

    if (!m) return m

    if (m.key) {
        m.id = m.key.id
        m.chat = m.key.remoteJid
        m.fromMe = m.key.fromMe
        m.isGroup = m.chat.endsWith('@g.us')
        m.sender = m.fromMe
            ? conn.user.id.split(':')[0] + '@s.whatsapp.net'
            : m.isGroup
            ? m.key.participant
            : m.chat
    }

    if (m.message) {
        m.type = getContentType(m.message)
        m.msg = m.type === 'viewOnceMessage'
            ? m.message[m.type].message[getContentType(m.message[m.type].message)]
            : m.message[m.type]

        m.body =
            m.msg?.text ||
            m.msg?.caption ||
            m.msg?.conversation ||
            m.msg?.selectedButtonId ||
            m.msg?.selectedId ||
            ''

        m.mentionUser = m.msg?.contextInfo?.mentionedJid || []

        /* ===== QUOTED ===== */
        if (m.msg?.contextInfo?.quotedMessage) {

            let quoted = m.msg.contextInfo.quotedMessage
            let type = getContentType(quoted)

            m.quoted = {
                type,
                id: m.msg.contextInfo.stanzaId,
                sender: m.msg.contextInfo.participant,
                message: quoted[type],
                download: (filename) => downloadMediaMessage({ type, msg: quoted[type] }, filename),
                delete: () => conn.sendMessage(m.chat, { delete: m.key }),
                react: (emoji) => conn.sendMessage(m.chat, {
                    react: { text: emoji, key: m.key }
                })
            }
        }

        m.download = (filename) => downloadMediaMessage(m, filename)
    }

    /* ================= REPLY SYSTEM ================= */

    m.reply = (text, chatId = m.chat, options = {}) => {
        return conn.sendMessage(chatId, {
            text: String(text),
            contextInfo: {
                mentionedJid: options.mentions || []
            }
        }, { quoted: m })
    }

    m.replyImg = (img, caption = '', chatId = m.chat, options = {}) => {
        const media = typeof img === 'string' && img.startsWith('http')
            ? { url: img }
            : img

        return conn.sendMessage(chatId, {
            image: media,
            caption,
            contextInfo: {
                mentionedJid: options.mentions || [],
                externalAdReply: {
                    title: BOT_NAME,
                    body: BOT_BRAND,
                    mediaType: 1,
                    renderLargerThumbnail: true,
                    thumbnailUrl: typeof img === 'string' ? img : null
                }
            }
        }, { quoted: m })
    }

    m.replyVid = (vid, caption = '', chatId = m.chat, options = {}) => {
        const media = typeof vid === 'string' && vid.startsWith('http')
            ? { url: vid }
            : vid

        return conn.sendMessage(chatId, {
            video: media,
            caption,
            gifPlayback: options.gif || false
        }, { quoted: m })
    }

    m.replyAud = (audio, chatId = m.chat, options = {}) => {
        const media = typeof audio === 'string' && audio.startsWith('http')
            ? { url: audio }
            : audio

        return conn.sendMessage(chatId, {
            audio: media,
            ptt: options.ptt || false,
            mimetype: options.mimetype || 'audio/mpeg'
        }, { quoted: m })
    }

    m.replyDoc = (doc, chatId = m.chat, options = {}) => {
        const media = typeof doc === 'string' && doc.startsWith('http')
            ? { url: doc }
            : doc

        return conn.sendMessage(chatId, {
            document: media,
            mimetype: options.mimetype || 'application/pdf',
            fileName: options.filename || 'ANGEL-DOC.pdf'
        }, { quoted: m })
    }

    m.react = (emoji) => {
        return conn.sendMessage(m.chat, {
            react: {
                text: emoji,
                key: m.key
            }
        })
    }

    return m
}

module.exports = {
    sms,
    downloadMediaMessage
}