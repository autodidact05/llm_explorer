# LLM Explorer — User Guide

LLM Explorer is a **local-first** app for chatting with many LLMs while tracking **every call’s cost**, tokens, and history on your machine.

---

## Quick start

1. **Register** on first launch (single-user install).
2. **Add an API key** in Settings → API Keys. Use **OpenRouter** (`sk-or-…`) for the full model catalogue, or **Groq** for Groq-hosted models only.
3. **Sync models** in Settings → Sync & Credits → Sync from OpenRouter (Groq models load automatically when Groq is active).
4. Open **Chat**, pick a model, and send a message.
5. Review spend on **Dashboard** and **Wallet**.

---

## API keys and providers

| Key type | How the app routes requests | Models you can use |
|----------|----------------------------|-------------------|
| **OpenRouter** | Through OpenRouter API | Any synced model (OpenAI, Anthropic, Google, Meta, …) |
| **Groq** | Directly to Groq | Only `groq/llama-3.1-8b-instant`, `groq/llama-3.3-70b-versatile`, `groq/openai/gpt-oss-120b`, and `groq/openai/gpt-oss-20b` |
| **OpenAI / Anthropic label** | Not supported as raw keys | Use an **OpenRouter** key instead; then pick `openai/…` or `anthropic/…` models |

You can save **both** an OpenRouter and a Groq key. In **Settings → API Keys**, use **LLM provider for chat** to switch which one is active (only one at a time).

**Balance display**

- **OpenRouter**: remaining credit/limit can be fetched and shown in banners and Settings.
- **Groq**: check usage at [console.groq.com](https://console.groq.com); this app cannot read Groq balance.
- **Wallet** in the app is your **local spend ledger** (deductions from chat), not necessarily equal to provider billing.

---

## Chat

- **Conversations** group multiple **sessions**; restarting keeps full history for the model.
- **Router LLM** (Settings → LLMs): optional auto model selection per message.
- **Brave Search**: optional web augmentation when configured.
- **Branches**: use *Branch here* on a message to explore an alternate path (like ChatGPT branches).
- **Attachments**: images, PDFs, and text files in the composer.
- **Image prompts**: estimated cost is shown before send when the message looks like image generation.

---

## Models page

Browse the synced catalogue, filter by provider/category, and see per-million-token pricing. After changing API key type, sync again and read the provider banner at the top of the page.

---

## Wallet & usage

- **Wallet**: running balance from top-ups and automatic deductions per LLM call.
- **Usage**: hierarchical drill-down Conversation → Session → Interaction → Message.
- **Export audit**: Settings → Preferences → Download CSV/JSON.

---

## History

Search conversations by title or message text. Open a conversation to see sessions, resume active chats, or export PDF.

---

## Invoke playground

Single-turn test at `/invoke` (not in the sidebar). Same API key rules as Chat.

---

## Contact

Use **Contact Me** in the sidebar for feedback, bug reports, or general comments — email [souvik.cloud@gmail.com](mailto:souvik.cloud@gmail.com).

---

## Docker

From the project root: `docker compose up --build` — API on port 8000, UI on 3000, data in `./data`.

---

## Tips

- Set **JWT_SECRET** and **OPENROUTER_API_KEY** in `.env` before first run.
- Enable **Router LLM** only after the catalogue is synced.
- Rate assistant replies and routing decisions to improve future routing.
- Read **Settings → Guide** (this document) anytime for reference.
