const tmi = require('tmi.js');
const axios = require('axios');
const express = require('express');

// Setup Express to satisfy Render's port-binding requirement
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('ChatDealer bot is running and connected to Twitch!');
});

app.listen(PORT, () => {
  console.log(`[HTTP] Server is listening on port ${PORT}`);
});

// 1. Core Bot & API Credentials (pulled from Render environment variables)
const BOT_USERNAME = 'chatdealer';
const OAUTH_TOKEN = process.env.BOT_OAUTH_TOKEN;
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;

let botUserId = null;

const client = new tmi.Client({
  options: { debug: false },
  identity: {
    username: BOT_USERNAME,
    password: OAUTH_TOKEN
  },
  channels: [] // Starts completely empty; populates automatically via mod status
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

    // Join new channels where you've been modded
    for (const channel of moddedChannels) {
      if (!currentChannels.includes(channel)) {
        await client.join(channel);
        console.log(`[AUTO-JOIN] Joined #${channel} (Mod status verified)`);
      }
    }

    // Leave channels where you are no longer a mod
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

// 3. Listen for the !blackjack command
client.on('message', (target, context, message, self) => {
  if (self) return;

  const args = message.trim().split(' ');
  const command = args[0].toLowerCase();

  if (command === '!blackjack') {
    const bet = args[1] || '1';
    client.say(target, `@${context.username} played blackjack with a bet of ${bet}! ♠️`);
  }
});

// 4. Connect to Twitch IRC, resolve user ID, and start background syncing
client.connect().then(async () => {
  console.log('ChatDealer connected to Twitch IRC successfully.');
  
  // Resolve the numeric ID first, then run initial sync
  await fetchBotUserId();
  syncModChannels();
  
  // Re-check mod permissions every 5 minutes automatically
  setInterval(syncModChannels, 5 * 60 * 1000);
});
