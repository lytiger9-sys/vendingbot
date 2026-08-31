export function getDiscordErrorCode(error) {
  return error?.code ?? error?.rawError?.code;
}

export function isExpiredInteractionError(error) {
  const code = getDiscordErrorCode(error);
  return code === 10062 || code === 10015;
}

export async function deferInteraction(interaction, options = {}) {
  if (interaction.replied || interaction.deferred) return false;

  try {
    await interaction.deferReply(options);
    return true;
  } catch (error) {
    if (isExpiredInteractionError(error)) return false;
    throw error;
  }
}

export async function replyInteraction(interaction, options) {
  try {
    if (interaction.deferred) return await interaction.editReply(options);
    if (interaction.replied) return await interaction.followUp(options);
    return await interaction.reply(options);
  } catch (error) {
    if (isExpiredInteractionError(error)) return null;
    throw error;
  }
}

export async function editInteraction(interaction, options) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(options);
    }
    return await replyInteraction(interaction, options);
  } catch (error) {
    if (isExpiredInteractionError(error)) return null;
    throw error;
  }
}

export async function followUpInteraction(interaction, options) {
  try {
    if (!interaction.replied && !interaction.deferred) {
      return await interaction.reply(options);
    }
    return await interaction.followUp(options);
  } catch (error) {
    if (isExpiredInteractionError(error)) return null;
    throw error;
  }
}

export async function updateInteraction(interaction, options) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(options);
    }
    return await interaction.update(options);
  } catch (error) {
    if (isExpiredInteractionError(error)) return null;
    throw error;
  }
}

export async function showModalInteraction(interaction, modal) {
  try {
    if (interaction.replied || interaction.deferred) return false;
    await interaction.showModal(modal);
    return true;
  } catch (error) {
    if (isExpiredInteractionError(error)) return false;
    throw error;
  }
}

export async function handleInteractionError(interaction, error, options = {}) {
  if (isExpiredInteractionError(error)) return null;
  return replyInteraction(interaction, {
    content: '⚠️ 처리 중 오류가 발생했습니다.',
    ...options,
  });
}
