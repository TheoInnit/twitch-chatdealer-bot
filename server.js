const express = require('express');
const tmi = require('tmi.js');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURATION ---
const CLIENT_ID = process.env.TWITCH_CLIENT_ID || "z4ylqbpm3ivqtxcj9h2iabfy2wajr6";
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET; 
const REDIRECT_URI = process.env.REDIRECT_URI;         
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL; 

// --- TWITCH BOT SETUP ---
const client = new tmi.Client({
    options: { debug: false },
    connection: { secure: true, reconnect: true },
    identity: {
        username: "chatdealer",
        password: process.env.BOT_OAUTH_TOKEN || "oauth:y94kev0rw91w0daernut8z9meyi3"
    },
    channels: [ "theoinnit_" ]
});

// 1. Fetch all saved channels from Google Sheets when the bot boots up
async function loadSavedChannels() {
    if (!GOOGLE_SCRIPT_URL) {
        console.warn("GOOGLE_SCRIPT_URL not set yet. Skipping saved channel load.");
        return;
    }
    try {
        const res = await axios.get(GOOGLE_SCRIPT_URL, { params: { action: 'getchannels' } });
        // Handle both format variations just in case (array vs object with channels property)
        const channelList = Array.isArray(res.data) ? res.data : (res.data.channels || []);
        
        for (const channel of channelList) {
            const cleanChannel = String(channel).trim().toLowerCase();
            if (cleanChannel && cleanChannel !== "theoinnit_") {
                await client.join(cleanChannel);
                console.log(`Joined saved channel: #${cleanChannel}`);
            }
        }
    } catch (err) {
        console.error("Failed to load saved channels on startup:", err.message);
    }
}

client.connect().then(() => {
    console.log("ChatDealer connected to Twitch IRC!");
    loadSavedChannels();
}).catch(console.error);

// 2. OAuth Callback Route (Triggered when a streamer invites the bot)
app.get('/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing authorization code.");

    try {
        const tokenRes = await axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: {
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: REDIRECT_URI
            }
        });

        const userAccessToken = tokenRes.data.access_token;

        const userRes = await axios.get('https://api.twitch.tv/helix/users', {
            headers: {
                'Authorization': `Bearer ${userAccessToken}`,
                'Client-Id': CLIENT_ID
            }
        });

        const streamerUsername = userRes.data.data[0].login;

        if (GOOGLE_SCRIPT_URL) {
            await axios.get(GOOGLE_SCRIPT_URL, {
                params: { action: 'addChannel', channel: streamerUsername }
            });
        }

        await client.join(streamerUsername);
        console.log(`New invite! Joined #${streamerUsername}`);

        res.send(`Success! ChatDealer has joined #${streamerUsername}'s chat. Make sure to type /mod chatdealer in your chat so it isn't rate-limited!`);
    } catch (error) {
        console.error("OAuth Invite Error:", error.response?.data || error.message);
        res.status(500).send("Something went wrong while inviting ChatDealer.");
    }
});

// 3. Health Check Route (For UptimeRobot pings)
app.get('/', (req, res) => {
    res.send('ChatDealer Multi-Channel Bot is online!');
});

// 4. Listen for Commands across ALL joined channels
client.on('message', async (target, context, message, self) => {
    if (self) return;

    const channelName = target.replace('#', '');
    const username = context.username;
    const trimmedMessage = message.trim();

    if (!trimmedMessage.startsWith('!')) return;

    const args = trimmedMessage.slice(1).split(' ');
    const command = args[0].toLowerCase();
    const argValue = args[1] || '';

    // Map chat commands to your Google Apps Script actions
    let action = '';
    let extraParams = {};

    switch (command) {
        case 'blackjack':
        case 'bj':
            action = 'blackjack';
            extraParams.arg = argValue;
            break;
        case 'hit':
            action = 'hit';
            break;
        case 'stand':
            action = 'stand';
            break;
        case 'dd':
        case 'doubledown':
            action = 'doubledown';
            break;
        case 'split':
            action = 'split';
            break;
        case 'insurance':
            action = 'insurance';
            break;
        case 'points':
        case 'bal':
        case 'balance':
            action = 'points';
            break;
        case 'daily':
            action = 'daily';
            break;
        case 'fortune':
            action = 'fortune';
            break;
        case 'top':
        case 'leaderboard':
            action = 'top';
            break;
        case 'deposit':
        case 'bankdeposit':
            action = 'bankdeposit';
            extraParams.arg = argValue;
            break;
        case 'withdraw':
        case 'bankwithdraw':
            action = 'bankwithdraw';
            extraParams.arg = argValue;
            break;
        case 'gift':
            action = 'gift';
            extraParams.recipient = args[1] || '';
            extraParams.amount = args[2] || '';
            break;
        default:
            return; // Not a recognized bot command
    }

    if (!GOOGLE_SCRIPT_URL) {
        return client.say(target, `@${username} The casino backend URL isn't configured yet!`);
    }

    try {
        const response = await axios.get(GOOGLE_SCRIPT_URL, {
            params: {
                user: username,
                channel: channelName,
                action: action,
                format: 'json',
                ...extraParams
            }
        });

        if (response.data && response.data.message) {
            client.say(target, response.data.message);
        } else if (typeof response.data === 'string') {
            client.say(target, response.data);
        }
    } catch (error) {
        console.error(`Error processing command !${command} in #${channelName}:`, error.message);
        client.say(target, `@${username} The casino backend encountered an error.`);
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
