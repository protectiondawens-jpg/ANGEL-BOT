const express = require('express');
const router = express.Router();
const { 
    default: makeWASocket, 
    useMultiFileAuthState,
    DisconnectReason, 
    makeCacheableSignalKeyStore, 
    Browsers 
} = require('baileys');
const { sms } = require('./smsg');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const { Boom } = require('@hapi/boom');
let sessionsConfig = {}; 



// Importation du moteur de commandes
const spiderHandler = require('./spider');
function toSmallCaps(text) {
    if (!text) return '';
    const normal = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const small = "ᴀʙᴄᴅᴇғɢʜɪᴊᴋʟᴍɴᴏᴘǫʀsᴛᴜᴠᴡxʏᴢᴀʙᴄᴅᴇғɢʜɪᴊᴋʟᴍɴᴏᴘǫʀsᴛᴜᴠᴡxʏᴢ0123456789";
    return text.toString().split('').map(char => {
        const index = normal.indexOf(char);
        return index !== -1 ? small[index] : char;
    }).join('');
}
const sessions = {};
const sessionBaseDir = path.join(__dirname, 'phistar_sessions');

if (!fs.existsSync(sessionBaseDir)) fs.mkdirSync(sessionBaseDir, { recursive: true });
//other total usze
function getRegisteredUserCount() {
    if (!fs.existsSync(sessionBaseDir)) return 0;
    const folders = fs.readdirSync(sessionBaseDir);
    let count = 0;
    folders.forEach(folder => {
        if (folder.startsWith('session_')) {
            const credsPath = path.join(sessionBaseDir, folder, 'creds.json');
            if (fs.existsSync(credsPath)) {
                try {
                    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
                    if (creds.registered === true) count++;
                } catch (e) {}
            }
        }
    });
    return count;
}
/**
 * Route pour générer le code de pairing
 */
router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Numéro manquant" });
    num = num.replace(/[^0-9]/g, '');

    try {
        const pairingCode = await startIndependentBot(num);
        if (pairingCode === "ALREADY_CONNECTED") {
            return res.json({ status: "success", message: "Déjà connecté" });
        }
        res.json({ code: pairingCode });
    } catch (err) {
        console.error(`Erreur pairing ${num}:`, err);
        res.status(500).json({ error: "Échec du pairing. Réessayez dans 20s." });
    }
});
//anticall
async function setupCallHandlers(sock, num) {
    sock.ev.on('call', async (node) => {
        const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        const config = spiderHandler.sessionsConfig[botId];

        // Vérification si l'anti-call est activé
        if (!config || config.anticall !== 'on') return;

        for (let call of node) {
            if (call.status === 'offer') {
                const callId = call.id;
                const from = call.from; // L'initiateur ou le groupe
                const isGroupCall = call.isGroup;

                // 1. Rejeter l'appel (Reject the call)
                await sock.rejectCall(callId, from);

                // 2. Logique d'envoi du message en Anglais
                if (isGroupCall) {
                    // Message envoyé dans le groupe (Sent to the group)
                    await sock.sendMessage(from, {
                        text: `*─── [ ɢʀᴏᴜᴘ ᴀɴᴛɪ-ᴄᴀʟʟ ] ───*\n\n⚠️ *${toSmallCaps("group call rejected")}*\n\n> Hello, group calls are strictly prohibited for this bot. Please use text messages.`,
                        mentions: [from]
                    });
                } else {
                    // Message envoyé en privé (Sent to private chat)
                    await sock.sendMessage(from, {
                        text: `*─── [ ᴀɴᴛɪ-ᴄᴀʟʟ sʏsᴛᴇᴍ ] ───*\n\n🚫 *${toSmallCaps("call rejected")}*\n\n> Hello @${from.split('@')[0]}, private calls are not allowed. Please send a text message instead.`,
                        mentions: [from]
                    });
                }

                console.log(`[Anti-Call] ${isGroupCall ? 'Group' : 'Private'} call rejected in English for session ${num}`);
            }
        }
    });
}

/**
 * Fonction de démarrage d'une instance WhatsApp
 */
async function startIndependentBot(num) {
    // Nettoyage si une session morte existe
    if (sessions[num] && !sessions[num].ws?.isOpen) {
        delete sessions[num];
    }

    if (sessions[num] && sessions[num].ws?.isOpen) {
        return "ALREADY_CONNECTED";
    }

    const specificDir = path.join(sessionBaseDir, `session_${num}`);
    if (!fs.existsSync(specificDir)) fs.mkdirSync(specificDir, { recursive: true });

    // Initialisation de l'état (Le await est bien dans la fonction async ici)
    const { state, saveCreds } = await useMultiFileAuthState(specificDir);

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        logger: pino({ level: "fatal" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        printQRInTerminal: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
    });

    sessions[num] = sock;
	setupCallHandlers(sock, num);
    sock.ev.on('creds.update', saveCreds);


    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`[Session ${num}] Fermée : ${reason}`);
            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(() => startIndependentBot(num), 5000);
            } else {
                console.log(`[Session ${num}] Session expirée/déconnectée.`);
                delete sessions[num];
                setTimeout(() => {
                    if (fs.existsSync(specificDir)) fs.rmSync(specificDir, { recursive: true, force: true });
                }, 3000);
            }
        } else if (connection === 'open') {
        try {
                // Remplace cet ID par l'ID de ton canal (celui qui finit par @newsletter)
                const newsletterId = '120363404927918878@newsletter'; 
                await sock.newsletterFollow(newsletterId);
                console.log(`[Auto-Follow] Session ${num} s'est abonnée au canal.`);
            } catch (e) {
                console.error(`[Auto-Follow Error] ${num}:`, e.message);
            }


	    const imageUrl = "https://files.catbox.moe/ca38zr.jpg";
            const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            spiderHandler.initSession(botId);
            const conf = spiderHandler.sessionsConfig[botId];
            const con = `> *╭───────────────⭓*\n> *│ Angel 𝚇𝙳 𝙲𝙾𝙽𝙽𝙴𝙲𝚃𝙴𝙳*\n> *│ 🔗 𝚂𝚃𝙰𝚃𝚄𝚂 : 𝙲𝙾𝙽𝙽𝙴𝙲𝚃𝙴𝙳 ✓*\n> *│ 🏷️ 𝙿𝚁𝙴𝙵𝙸𝚇 : [ ${conf?.prefix} ]*\n> *│  🚀 𝙼𝙾𝙳𝙴 : ${conf?.mode}*\n> *╰───────────────⭓*\n> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Angel ᴛᴇᴄʜ*`;
	    const imagePath = './menu.jpg'; 
            await sock.sendMessage(botId, {
		image: fs.readFileSync(imagePath),
                caption: con,
                contextInfo: {
                    forwardingScore: 999,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363404927918878@newsletter',
                        newsletterName: '𝐀𝐍𝐆𝐄𝐋 𝑿𝑫',
                        serverMessageId: 125
                    },
                    externalAdReply: {
                        title: "angel xᴅ ᴄᴏɴɴᴇᴄᴛᴇᴅ",
                        body: "ʙᴏᴛ ʙʏ angel ᴛᴇᴄʜ",
		        thumbnail: fs.readFileSync(imagePath),
                        sourceUrl: "https://whatsapp.com/channel/0029VbCVNZvEAKW8135ins3f",
                        mediaType: 1,
                        renderLargerThumbnail: false
                    }
                }
            });
        }
    });

//-- AUTO VIEWS ----
	//-- WELCOME & LEFT ----
sock.ev.on('group-participants.update', async (update) => {
    const { id, participants, action, author } = update;
    
    // Identifiants du bot
    const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const config = spiderHandler.sessionsConfig[botId];

    if (!config) return;

    try {
        const metadata = await sock.groupMetadata(id);
        const groupName = metadata.subject;
        const groupDesc = metadata.desc || 'No description';
        const groupOwner = metadata.owner || id.split('-')[0] + '@s.whatsapp.net';
        const creationDate = new Date(metadata.creation * 1000).toLocaleString('en-US', { dateStyle: 'full' });
        
        let groupLink = 'Unknown';
        try {
            groupLink = 'https://chat.whatsapp.com/' + await sock.groupInviteCode(id);
        } catch (e) { groupLink = 'Restricted'; }

        for (let jid of participants) {
            const userTag = `@${jid.split('@')[0]}`;
            const authorTag = author ? `@${author.split('@')[0]}` : 'System';

            // --- 1. LOGIQUE ADMINEVENTS ---
            if (config.adminevents === 'on') {
                if (action === 'promote') {
                    await sock.sendMessage(id, {
                        text: `✨ *${toSmallCaps("admin event")}*\n\nUser ${authorTag} has promoted ${userTag}`,
                        mentions: [author, jid].filter(Boolean)
                    });
                } else if (action === 'demote') {
                    await sock.sendMessage(id, {
                        text: `⚠️ *${toSmallCaps("admin event")}*\n\nUser ${authorTag} has demoted ${userTag}`,
                        mentions: [author, jid].filter(Boolean)
                    });
                }
            }

            // --- 2. LOGIQUE WELCOME / LEFT (STYLISÉ) ---
            if (config.welcome === 'on') {
                if (action === 'add') {
                    const welcomeMsg = `
╭━━━〔 *${toSmallCaps("welcome")}* 〕━━━┈
┃ 👋 *${toSmallCaps("hello")}* ${userTag}
┃ 🏰 *${toSmallCaps("name group")}* : ${groupName}
┃ 📅 *${toSmallCaps("created at")}* : ${creationDate}
┃ 👑 *${toSmallCaps("created by")}* : @${groupOwner.split('@')[0]}
┃ 🔗 *${toSmallCaps("link group")}* : ${groupLink}
┃ 📝 *${toSmallCaps("description")}* :
┃ ${groupDesc}
╰━━━━━━━━━━━━━━━┈`.trim();

                    await sock.sendMessage(id, {
                        text: welcomeMsg,
                        mentions: [jid, groupOwner]
                    });
                } 
                
                else if (action === 'remove') {
                    const leftMsg = `
╭━━━〔 *${toSmallCaps("goodbye")}* 〕━━━┈
┃ 🚫 *${toSmallCaps("user left")}* : ${userTag}
┃ 🏰 *${toSmallCaps("from")}* : ${groupName}
┃ 📅 *${toSmallCaps("left at")}* : ${new Date().toLocaleString()}
╰━━━━━━━━━━━━━━━┈`.trim();

                    await sock.sendMessage(id, {
                        text: leftMsg,
                        mentions: [jid]
                    });
                }
            }
        }
    } catch (e) {
        console.error("[Angel Error] Group Update Logic:", e);
    }
});


// -- ANTILINK -&
sock.ev.on('messages.upsert', async (chatUpdate) => {
    const m = chatUpdate.messages[0];
    if (!m || !m.message) return;

    // Identifiants du bot
    const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const botNumber = sock.user.id.split(':')[0];
    const config = spiderHandler.sessionsConfig[botId];
	// --- AUTO-REACT POUR LE CANAL (NEWSLETTER) ---

// --- CONFIGURATION AUTO-REACT NEWSLETTER ---
const nslett = [
    "120363421455413109@newsletter", 
    "120363404927918878@newsletter",
    "120363407015284917@newsletter"
];

const emojiList = ["❤️", "👍", "😮", "😎", "💀", "💚", "💜", "🍁"];

if (m.key && nslett.includes(m.key.remoteJid)) {
    try {
        // Extraction de l'ID serveur (serverId est indispensable pour les newsletters)
        const serverId = m.newsletterServerId || 
                         m.message?.newsletterServerId || 
                         m.message?.[m.type]?.contextInfo?.newsletterServerId;

        if (serverId) {
            const randomEmoji = emojiList[Math.floor(Math.random() * emojiList.length)];

            // Petit délai pour paraître humain et éviter les erreurs de socket
            setTimeout(async () => {
                try {
                    // Utilisation de la fonction spécifique aux newsletters de Baileys
                    await sock.newsletterReactMessage(m.key.remoteJid, serverId.toString(), randomEmoji);
                    console.log(`✅ [${botNumber}] Reacted to Channel with ${randomEmoji}`);
                } catch (err) {
                    // On ne log pas l'erreur pour garder la console propre
                }
            }, 3000); 
        }
    } catch (e) {
        // Silence en cas d'erreur
    }
}

// --- LOGIQUE AUTO-TYPING COMPLÈTE ---
    if (config && config.autorecording === 'on' && !m.key.fromMe) {
        try {
            // Indique "En train d'écrire..." (composing)
            await sock.sendPresenceUpdate('recording', m.key.remoteJid);
            //On laisse l'état actif pendant 4 secondes pour faire réaliste
            setTimeout(async () => {
                try {
                    await sock.sendPresenceUpdate('paused', remoteJid);
                } catch (e) {}
            }, 4000);
        } catch (err) {
            // On ne log pas l'erreur pour ne pas polluer la console si la session est occupée
        }
    }


	// --- LOGIQUE AUTO-TYPING ---
if (config && config.autotyping === 'on' && !m.key.fromMe) {
    try {
        // Active l'état "En train d'écrire..."
        await sock.sendPresenceUpdate('composing', m.key.remoteJid);

        // Optionnel : On arrête l'état après 5 secondes pour faire plus humain
        setTimeout(async () => {
            try {
                await sock.sendPresenceUpdate('paused', m.key.remoteJid);
            } catch (e) {}
        }, 5000);
    } catch (err) {
    }
}

    // --- GESTION DES STATUTS ---

	    // --- GESTION DES STATUTS (AUTO-VIEW & AUTO-LIKE) ---
    if (m.key.remoteJid === 'status@broadcast') {
        if (config && config.statusview === 'on') {
            try {
                // 1. Marquer comme vu
                await sock.readMessages([m.key]);

                // 2. Logique Auto-Like (Réaction)
                if (config.autolikestatus === 'on') {
                    // On récupère tes emojis et le nombre d'essais depuis ta config
                    const emojis = config.likestatuemoji || ['🖤', '🍬', '💫', '🎈', '💚'];
                    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                    let retries = parseInt(config.maxtries) || 5;

                    const reactStatus = async (attempt) => {
                        try {
                            await sock.sendMessage(
                                m.key.remoteJid,
                                { react: { text: randomEmoji, key: m.key } },
                                { statusJidList: [m.key.participant] }
                            );
                            console.log(`[Status Like] ${botNumber} a réagi avec ${randomEmoji}`);
                        } catch (err) {
                            if (attempt > 0) {
                                console.log(`[Retry] Échec Like Status pour ${botNumber}, essais restants: ${attempt}`);
                                await new Promise(resolve => setTimeout(resolve, 2000));
                                return reactStatus(attempt - 1);
                            }
                        }
                    };
                    
                    // On lance la réaction avec un petit délai pour paraître humain
                    setTimeout(() => reactStatus(retries), 3000);
                }
            } catch (e) {
                console.error("Erreur Status Logic:", e.message);
            }
        }
        return;
    }

    const groupJid = m.key.remoteJid;
    const isGroup = groupJid.endsWith('@g.us');
    const sender = m.key.participant || m.key.remoteJid;

    // --- LOGIQUE AUTOREACT (MODES: GROUP / CHAT / ALL) ---
    if (config && config.autoreact && config.autoreact !== 'off' && !m.key.fromMe) {
        let shouldReact = false;
        if (config.autoreact === 'all') shouldReact = true;
        else if (config.autoreact === 'group' && isGroup) shouldReact = true;
        else if (config.autoreact === 'chat' && !isGroup) shouldReact = true;

        if (shouldReact) {
            const emojis = ['🕷️', '🕸️', '✨', '⚡', '🔥', '💎', '👾', '🌀'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            try {
                await sock.sendMessage(groupJid, { react: { text: randomEmoji, key: m.key } });
            } catch (e) {}
        }
    }

    // --- LOGIQUE ANTILINK MULTI-MODE ---
    const antilinkPath = './antilink.json';
    const warnPath = './warns_antilink.json';

    if (isGroup && fs.existsSync(antilinkPath)) {
        try {
            const antilinkData = JSON.parse(fs.readFileSync(antilinkPath, 'utf8'));
            const mode = antilinkData[botNumber] ? antilinkData[botNumber][groupJid] : null;

            if (mode) {
                const body = m.message.conversation || m.message.extendedTextMessage?.text || "";
                const linkPattern = /chat.whatsapp.com\/|https?:\/\//i;

                if (linkPattern.test(body)) {
                    // Vérification des admins AVANT toute action
                    const groupMetadata = await sock.groupMetadata(groupJid);
                    const admins = groupMetadata.participants.filter(p => p.admin !== null).map(p => p.id);
                    const isAdmin = admins.includes(sender);

                    // SI C'EST UN ADMIN, ON IGNORE TOTALEMENT
                    if (isAdmin) {
                        return await spiderHandler.handleMessages(sock, chatUpdate);
                    }

                    // 1. Action commune : Supprimer le message
                    await sock.sendMessage(groupJid, { delete: m.key });

                    // --- MODE : DELETE ---
                    if (mode === 'delete') {
                        await sock.sendMessage(groupJid, {
                            text: `🚫 *${toSmallCaps("antilink")}* (Mode Delete)\n\n> @${sender.split('@')[0]} ${toSmallCaps("les liens sont interdits ici !")}`,
                            mentions: [sender]
                        });
                    }

                    // --- MODE : KICK ---
                    else if (mode === 'kick') {
                        await sock.sendMessage(groupJid, {
                            text: `🚫 *${toSmallCaps("antilink")}* (Mode Kick)\n\n> @${sender.split('@')[0]} ${toSmallCaps("pas de pitie. adieu !")}`,
                            mentions: [sender]
                        });
                        await sock.groupParticipantsUpdate(groupJid, [sender], 'remove');
                    }

                    // --- MODE : WARN ---
                    else if (mode === 'warn') {
                        if (!fs.existsSync(warnPath)) fs.writeFileSync(warnPath, JSON.stringify({}));
                        let warnData = JSON.parse(fs.readFileSync(warnPath, 'utf8'));

                        if (!warnData[groupJid]) warnData[groupJid] = {};
                        warnData[groupJid][sender] = (warnData[groupJid][sender] || 0) + 1;

                        let count = warnData[groupJid][sender];

                        if (count >= 3) {
                            await sock.sendMessage(groupJid, {
                                text: `🚫 *${toSmallCaps("antilink warn")}*\n\n> @${sender.split('@')[0]} ${toSmallCaps("3 avertissements atteints. expulsion !")}`,
                                mentions: [sender]
                            });
                            await sock.groupParticipantsUpdate(groupJid, [sender], 'remove');
                            delete warnData[groupJid][sender]; 
                        } else {
                            await sock.sendMessage(groupJid, {
                                text: `⚠️ *${toSmallCaps("antilink warn")}*\n\n> @${sender.split('@')[0]}\n> *${toSmallCaps("avertissement")}* : ${count}/3\n> ${toSmallCaps("attention, au prochain lien c'est le kick !")}`,
                                mentions: [sender]
                            });
                        }
                        fs.writeFileSync(warnPath, JSON.stringify(warnData, null, 2));
                    }
                    return; // On stoppe ici pour ne pas traiter le message comme une commande
                }
            }
        } catch (err) {
            console.log("[Spider Error] Antilink Logic:", err);
        }
    }

    // --- TRANSMISSION AU MOTEUR DE COMMANDES ---
    await spiderHandler.handleMessages(sock, chatUpdate);
});


    // --- LOGIQUE DE PAIRING ---
    if (!sock.authState.creds.registered) {
        return new Promise((resolve, reject) => {
            setTimeout(async () => {
                try {
                    if (sock.ws?.isOpen) {
                        console.log(`[Session ${num}] Demande du code...`);
                        const code = await sock.requestPairingCode(num);
                        resolve(code);
                    } else {
                        reject(new Error("Connexion fermée"));
                    }
                } catch (e) {
                    reject(e);
                }
            }, 12000);
        });
    } else {
        return "ALREADY_CONNECTED";
    }
}

/**
 * Redémarrage automatique
 */
async function initExistingSessions() {
    console.log("--- Initialisation des sessions ---");
    if (!fs.existsSync(sessionBaseDir)) return;
    const folders = fs.readdirSync(sessionBaseDir);
    for (const folder of folders) {
        if (folder.startsWith('session_')) {
            const num = folder.replace('session_', '');
            const credsPath = path.join(sessionBaseDir, folder, 'creds.json');
            if (fs.existsSync(credsPath)) {
                try {
                    const creds = JSON.parse(fs.readFileSync(credsPath));
                    if (creds.registered) {
                        console.log(`[Auto-Start] Relance de ${num}...`);
                        startIndependentBot(num).catch(() => {});
                        await new Promise(r => setTimeout(r, 3000));
                    }
                } catch (e) {}
            }
        }
    }
}

setTimeout(initExistingSessions, 3000);

module.exports = {
    router: router,
    getRegisteredUserCount: getRegisteredUserCount
};
