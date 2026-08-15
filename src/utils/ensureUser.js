/**
 * 디스코드 상호작용을 한 유저의 User 레코드가 DB에 반드시 존재하도록 보장한다.
 * 웹 대시보드에 로그인한 적 없는 유저가 디스코드 명령어/버튼/모달만으로
 * 먼저 액션을 취할 경우 User 레코드가 없어서 이후 로직(잔액 증가, 수동충전 등)이
 * P2025(Record not found)로 실패하는 문제를 근본적으로 막기 위한 함수.
 *
 * interactionCreate.js에서 모든 상호작용 진입 시 한 번만 호출하면 된다.
 */
export async function ensureUserExists(prisma, discordUser) {
  if (!discordUser || discordUser.bot) {
    return;
  }

  try {
    await prisma.user.upsert({
      where: { id: discordUser.id },
      update: {},
      create: {
        id: discordUser.id,
        username: discordUser.username,
        avatar: discordUser.avatar,
        balance: 0,
        totalSpent: 0,
        blacklisted: false
      }
    });
  } catch (error) {
    // 여기서 실패해도 상호작용 처리 자체를 막지는 않는다.
    // (실패하더라도 각 핸들러에서 여전히 개별적으로 방어 로직을 갖고 있음)
    console.error(`[ensure-user] failed to upsert user ${discordUser.id}:`, error);
  }
}