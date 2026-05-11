'use strict';

/**
 * notifier.js — Outbound message dispatch for the Reactive Execution Fabric
 *
 * Wraps platform SDKs into a single send() call.
 * Platforms: "discord" | "telegram" | "console"
 *
 * Discord and Telegram clients are initialized lazily (only when first used),
 * so the process doesn't crash if tokens are missing for unused platforms.
 */

require('dotenv').config();

// ── Platform Clients (lazy init) ──────────────────────────────────────────────
let discordClient   = null;
let telegramClient  = null;

/**
 * Initialize and return the Discord client (singleton).
 * @returns {Promise<import('discord.js').Client>}
 */
async function getDiscordClient() {
  if (discordClient) return discordClient;

  const { Client, GatewayIntentBits } = require('discord.js');
  const token = process.env.DISCORD_TOKEN;

  if (!token || token === 'your_discord_bot_token_here') {
    throw new Error('DISCORD_TOKEN is not configured in .env');
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(token);

  // Wait until ready
  await new Promise((resolve, reject) => {
    client.once('ready', resolve);
    client.once('error', reject);
    setTimeout(() => reject(new Error('Discord login timeout')), 15_000);
  });

  discordClient = client;
  console.log(`📡 [Notifier] Discord client ready as ${client.user.tag}`);
  return discordClient;
}

/**
 * Initialize and return the Telegram client (singleton).
 * @returns {import('node-telegram-bot-api')}
 */
function getTelegramClient() {
  if (telegramClient) return telegramClient;

  const TelegramBot = require('node-telegram-bot-api');
  const token = process.env.TELEGRAM_TOKEN;

  if (!token || token === 'your_telegram_bot_token_here') {
    throw new Error('TELEGRAM_TOKEN is not configured in .env');
  }

  // outbound-only — no polling
  telegramClient = new TelegramBot(token, { polling: false });
  console.log('📡 [Notifier] Telegram client initialized (outbound mode)');
  return telegramClient;
}

// ── send() ────────────────────────────────────────────────────────────────────

/**
 * Send a proactive message to the configured platform.
 *
 * @param {string} platform   - "discord" | "telegram" | "console"
 * @param {string|null} targetId  - Channel ID (discord) or Chat ID (telegram).
 *                                  Falls back to env defaults if null.
 * @param {string} message    - The text to send
 * @returns {Promise<void>}
 */
async function send(platform, targetId, message) {
  const resolvedPlatform = (platform || process.env.NOTIFY_PLATFORM || 'console').toLowerCase();

  switch (resolvedPlatform) {
    // ── Console (default/test mode) ──────────────────────────────────────────
    case 'console': {
      const sep = '─'.repeat(60);
      console.log(`\n📢 [Notifier — Console]\n${sep}\n${message}\n${sep}\n`);
      break;
    }

    // ── Discord ───────────────────────────────────────────────────────────────
    case 'discord': {
      const channelId = targetId || process.env.DISCORD_NOTIFY_CHANNEL_ID;
      if (!channelId) throw new Error('No Discord channel ID configured. Set DISCORD_NOTIFY_CHANNEL_ID in .env or per-job target_id.');

      const client  = await getDiscordClient();
      const channel = await client.channels.fetch(channelId);

      if (!channel || !channel.isTextBased()) {
        throw new Error(`Discord channel ${channelId} not found or is not a text channel`);
      }

      // Discord has a 2000-char limit per message — chunk if needed
      const CHUNK_SIZE = 1900;
      for (let i = 0; i < message.length; i += CHUNK_SIZE) {
        await channel.send(message.slice(i, i + CHUNK_SIZE));
      }

      console.log(`✅ [Notifier] Delivered to Discord channel ${channelId}`);
      break;
    }

    // ── Telegram ─────────────────────────────────────────────────────────────
    case 'telegram': {
      const chatId = targetId || process.env.TELEGRAM_NOTIFY_CHAT_ID;
      if (!chatId) throw new Error('No Telegram chat ID configured. Set TELEGRAM_NOTIFY_CHAT_ID in .env or per-job target_id.');

      const bot = getTelegramClient();
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

      console.log(`✅ [Notifier] Delivered to Telegram chat ${chatId}`);
      break;
    }

    default:
      throw new Error(`Unknown notification platform: "${resolvedPlatform}". Use "discord", "telegram", or "console".`);
  }
}

/**
 * Gracefully destroy active platform clients (call on process shutdown).
 */
async function destroy() {
  if (discordClient) {
    await discordClient.destroy();
    discordClient = null;
  }
  if (telegramClient) {
    telegramClient.stopPolling && telegramClient.stopPolling();
    telegramClient = null;
  }
}

module.exports = { send, destroy };
