export async function sendTelegram(
  message: string,
  chatId: string
) {
  const token = process.env.TELEGRAM_TOKEN;
  console.log("TG TOKEN:", process.env.TELEGRAM_TOKEN);

  if (!token) {
    console.log("Telegram not configured");
    return;
  }

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
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
}