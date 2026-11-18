const express = require('express');
const tmi = require('tmi.js');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURATION ---
const CLIENT_ID = process.env.TWITCH_CLIENT_ID || "z4ylqbpm3ivqtxcj9h2iabfy2wajr6";
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET; // Set in Koyeb Environment Variables
const REDIRECT_URI = process.env.REDIRECT_URI;         // Set in Koyeb Environment Variables (e.g., https://your-app.koyeb.app/callback)
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL; // Set in Koyeb Environment Variables

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
        const res = await axios.get(GOOGLE_SCRIPT_URL, { params: { action: 'getChannels' } });
        if (res.data && Array.isArray(res.data.channels)) {
            for (const channel of res.data.channels) {
                if (channel.toLowerCase() !== "theoinnit_") {
                    await client.join(channel);
                    console.log(`Joined saved channel: #${channel}`);
                }
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
        // Exchange the temporary code for an access token
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

        // Fetch the inviting streamer's username from Twitch API
        const userRes = await axios.get('https://api.twitch.tv/helix/users', {
            headers: {
                'Authorization': `Bearer ${userAccessToken}`,
                'Client-Id': CLIENT_ID
            }
        });

        const streamerUsername = userRes.data.data[0].login;

        // Save the new channel to Google Sheets so it persists across restarts
        if (GOOGLE_SCRIPT_URL) {
            await axios.get(GOOGLE_SCRIPT_URL, {
                params: { action: 'addChannel', channel: streamerUsername }
            });
        }

        // Immediately join the streamer's chat live!
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

// 4. Listen for Blackjack Commands across ALL joined channels
client.on('message', async (target, context, message, self) => {
    if (self) return;

    const channelName = target.replace('#', '');
    const username = context.username;

    if (message.startsWith('!blackjack') || message.startsWith('!bj')) {
        const args = message.split(' ');
        const betAmount = args[1] || '100';

        if (!GOOGLE_SCRIPT_URL) {
            return client.say(target, `@${username} The casino backend URL isn't configured yet!`);
        }

        try {
            const response = await axios.get(GOOGLE_SCRIPT_URL, {
                params: {
                    user: username,
                    channel: channelName,
                    action: 'blackjack',
                    bet: betAmount
                }
            });

            if (response.data && response.data.message) {
                client.say(target, `@${username} ${response.data.message}`);
            }
        } catch (error) {
            console.error(`Error in #${channelName}:`, error.message);
            client.say(target, `@${username} The casino backend is currently unreachable.`);
        }
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
