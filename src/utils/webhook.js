import {
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from 'discord.js';

let smsWebhook = null;

export function initWebhook(client) {
  if (process.env.SMS_WEBHOOK_URL) {
    const webhookData = parseWebhookUrl(process.env.SMS_WEBHOOK_URL);
    if (webhookData) {
      smsWebhook = { ...webhookData, client };
    }
  }
}

export async function sendWebhookMessage(webhook, content) {
  if (!webhook) return;

  try {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(String(content ?? '')),
    );

    const webhookClient = await webhook.client.fetchWebhook(webhook.id, webhook.token);
    await webhookClient.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (error) {
    console.error('Webhook send error:', error);
  }
}

export async function sendSMSAlert(message) {
  if (smsWebhook) {
    await sendWebhookMessage(smsWebhook, message);
  }
}

function parseWebhookUrl(url) {
  const match = url.match(/discord(?:\.com|app\.com)\/api\/webhooks\/(\d+)\/([^/]+)/);
  if (match) {
    return { id: match[1], token: match[2] };
  }
  return null;
}
