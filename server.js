const tmi = require('tmi.js');
const axios = require('axios');
const express = require('express');

// Setup Express to satisfy Render's port-binding requirement
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('ChatDealer bot is running and connected to Twitch via Google Apps Script!');
});

app.listen(PORT, () => {
  console.log(`[HTTP] Server is listening on port ${PORT}`);
});

// 1. Core Bot & API Credentials (pulled from Render environment variables)
const BOT_USERNAME = 'chatdealer';
const OAUTH_TOKEN = process.env.BOT_OAUTH_TOKEN;
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;

// PASTE YOUR GOOGLE APPS SCRIPT WEB APP URL HERE:
const GAS_WEB_APP_URL = 'YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';

let botUserId = null;

const client = new tmi.Client({
  options: { debug: false },
  identity: {
    username: BOT_USERNAME,
    password: OAUTH_TOKEN
  },
  channels: [] // Populates automatically via mod status
});

// Helper: Automatically fetch the bot's numeric user ID from Twitch Helix API on boot
async function fetchBotUserId() {
  try {
    const response = await axios.get(`https://api.twitch.tv/helix/users?login=${BOT_USERNAME}`, {
      headers: {
        'Authorization': `Bearer ${OAUTH_TOKEN.replace('oauth:', '')}`,
        'Client-Id': CLIENT_ID
      }
    });
    if (response.data && response.data.data.length > 0) {
      botUserId = response.data.data[0].id;
      console.log(`[INIT] Resolved bot user ID for ${BOT_USERNAME}: ${botUserId}`);
    } else {
      console.error('[INIT] Could not find Twitch user ID for username:', BOT_USERNAME);
    }
  } catch (err) {
    console.error('Error fetching bot user ID:', err.response?.data || err.message);
  }
}

// 2. Automatically sync and join channels where your bot is a Moderator
async function syncModChannels() {
  if (!botUserId) {
    console.log('[SYNC] Skipping mod sync; bot user ID not yet initialized.');
    return;
  }

  try {
    const response = await axios.get(`https://api.twitch.tv/helix/moderation/channels?user_id=${botUserId}`, {
      headers: {
        'Authorization': `Bearer ${OAUTH_TOKEN.replace('oauth:', '')}`,
        'Client-Id': CLIENT_ID
      }
    });

    const moddedChannels = response.data.data.map(ch => ch.broadcaster_login.toLowerCase());
    const currentChannels = client.getChannels().map(c => c.replace('#', ''));

    for (const channel of moddedChannels) {
      if (!currentChannels.includes(channel)) {
        await client.join(channel);
        console.log(`[AUTO-JOIN] Joined #${channel} (Mod status verified)`);
      }
    }

    for (const channel of currentChannels) {
      if (!moddedChannels.includes(channel)) {
        await client.part(channel);
        console.log(`[AUTO-PART] Left #${channel} (Mod status removed)`);
      }
    }
  } catch (err) {
    console.error('Error syncing mod channels:', err.response?.data || err.message);
  }
}

// 3. Forward Chat Commands to Google Apps Script
client.on('message', async (target, context, message, self) => {
  if (self) return;

  const username = context.username;
  const msgText = message.trim();
  if (!msgText.startsWith('!')) return;

  const args = msgText.slice(1).split(' ');
  const action = args[0].toLowerCase();
  const arg = args.slice(1).join(' ');

  // Map common aliases to match your Google Apps Script actions
  let mappedAction = action;
  if (action === 'bj') mappedAction = 'blackjack';
  if (action === 'dd') mappedAction = 'doubledown';

  // Actions supported by your Apps Script backend
  const supportedActions = [
    'blackjack', 'bj', 'hit', 'stand', 'doubledown', 'dd', 
    'split', 'insurance', 'daily', 'fortune', 'points', 'top', 'gift'
  ];

  if (!supportedActions.includes(mappedAction)) return;

  try {
    // Make an HTTP GET request to your Google Apps Script Web App
    const response = await axios.get(GAS_WEB_APP_URL, {
      params: {
        action: mappedAction,
        user: username,
        arg: arg
      }
    });

    // Google Apps Script returns text output directly (e.g., game result strings or leaderboards)
    const replyText = response.data;
    if (replyText && typeof replyText === 'string' && replyText.trim().length > 0) {
      client.say(target, replyText);
    }
  } catch (err) {
    console.error('Error communicating with Google Apps Script:', err.message);
  }
});

// 4. Connect to Twitch IRC, resolve user ID, and start background syncing
client.connect().then(async () => {
  console.log('ChatDealer connected to Twitch IRC successfully.');
  
  await fetchBotUserId();
  syncModChannels();
  
  setInterval(syncModChannels, 5 * 60 * 1000);
});
