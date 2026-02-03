/**
 * Notification channel adapters
 */

export { EmailAdapter, formatEmailSubject, formatEmailBody, formatEmailHtml } from "./email.js";
export { SlackAdapter, buildSlackBlocks, getUrgencyEmoji, formatJson } from "./slack.js";
export { DiscordAdapter, buildDiscordEmbed, getEventColor } from "./discord.js";
export { WebhookAdapter, signPayload, buildWebhookPayload } from "./webhook.js";
