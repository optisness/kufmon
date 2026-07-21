export async function sendTelegram(
  message: string,
  chatId: string
) {
  const token = process.env.TELEGRAM_TOKEN;

  if (!token) {
    // Telegram not configured — skip but don't leak secrets
    return false;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true,
      }),
    });

    return res.ok;
  } catch (err) {
    console.error("Telegram send error:", err);
    return false;
  }
}