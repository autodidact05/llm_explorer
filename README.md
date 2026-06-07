# LLM Explorer

LLM usage tracking, cost analysis, and multi-turn chat via [OpenRouter](https://openrouter.ai).

Routes all model calls through the OpenRouter API, records every token exchange, calculates costs, and persists a full audit trail to a local SQLite database. A Next.js web UI provides chat, history, cost analysis, model browsing, and settings — all running locally with no external dependencies beyond OpenRouter.

---

## Review Requested
Please review architecture, code quality, and documentation.

## Features

### Chat
- **Conversation hierarchy** — chats are organised as *Conversations → Sessions → Interactions → Messages*. A conversation groups all sessions together; restarting a chat adds a new session to the same conversation so the full context is preserved
- **Restart conversations** — end a session and restart later; the LLM receives the complete message history across all prior sessions
- **Multi-modal uploads** — attach images, PDFs, and text files directly in the chat input; files are saved locally to `data/uploaded_data/`
- **Model switching** — change provider and model mid-conversation; the new model receives the full session history
- **Session date injection** — every LLM call is prefixed with today's date so models always know the current date
- **Per-session stats panel** — live token count, cost, average response time, and HTTP status per interaction; drill down to see individual call breakdowns

### History & Export
- **Conversation-level history** — browse conversations with aggregated cost across all sessions; expand to see individual sessions
- **PDF download** — export any chat session as a formatted PDF via the browser's native print dialog
- **Failed call logging** — API errors (rate limits, timeouts, etc.) are recorded in the audit log with the real HTTP status code, so nothing is silently lost

### Cost & Credits
- **Credit ledger** — track manual top-ups and automatic LLM deductions with a running balance
- **Currency conversion** — display costs in GBP, EUR, INR, CNY, JPY, or AUD alongside the USD amount; rates fetched once per day from `open.er-api.com` and cached in the database

### Models & Settings
- **Model catalogue** — sync live pricing from OpenRouter or load from a local CSV; filter by provider, category, or search term; hover any model to see context size and per-million-token costs
- **API key management** — add multiple named API keys, activate one at a time, delete old ones — all from the Settings page without editing `.env`

---

## Architecture

```
src/
  backend/        FastAPI server  (Python 3.13+, uv)
  frontend/       Next.js web UI  (Tailwind CSS)
data/             SQLite database + audit log + uploaded files  (gitignored)
scripts/          Admin scripts (model price seeding)
tests/            Pytest test suite
notebooks/        Jupyter notebooks
```

### Database schema

| Table | Purpose |
|---|---|
| `model_pricing` | Model catalogue with per-million-token input/output pricing |
| `usage_audit` | Immutable record of every LLM call: tokens, cost, latency, HTTP status |
| `credits` | Top-up and deduction ledger with running balance |
| `currency_rates` | Daily exchange rate cache (USD → selected currencies) |
| `chat_conversations` | Top-level conversation container; groups one or more sessions |
| `chat_sessions` | Individual chat sessions within a conversation (active / ended) |
| `chat_interactions` | Provider+model group within a session; aggregates calls for the stats panel |
| `chat_messages` | Individual user and assistant messages; cascade-deleted with their session |
| `api_keys` | Named API keys; one can be active at a time |

### API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/stats` | Dashboard summary — total cost, tokens, queries, recent activity |
| `GET` | `/api/models` | Paginated model catalogue with filters |
| `GET` | `/api/models/providers` | Distinct provider list |
| `GET` | `/api/models/categories` | Distinct category list |
| `POST` | `/api/models/sync` | Sync pricing from OpenRouter or local CSV |
| `GET` | `/api/usage` | Paginated usage audit log |
| `GET` | `/api/credits` | Paginated credit ledger with running balance |
| `POST` | `/api/invoke` | Single-turn LLM invocation (playground) |
| `GET` / `PUT` | `/api/config` | Read / update app configuration |
| `GET` | `/api/currency` | Exchange rates (fetched or served from daily cache) |
| `GET` | `/api/keys` | List stored API keys (values masked) |
| `POST` | `/api/keys` | Add a new named API key |
| `PUT` | `/api/keys/{id}/activate` | Set a key as active |
| `DELETE` | `/api/keys/{id}` | Delete a stored key |
| `POST` | `/api/chat/sessions` | Create a new conversation + first session |
| `GET` | `/api/chat/sessions/{id}` | Session detail with messages, prior-session messages, and interactions |
| `POST` | `/api/chat/sessions/{id}/messages` | Send a message (non-streaming) |
| `POST` | `/api/chat/sessions/{id}/messages/stream` | Send a message (SSE token stream) |
| `POST` | `/api/chat/messages/{id}/rating` | Rate an assistant message (1–3) |
| `POST` | `/api/chat/interactions/{id}/rating` | Rate a routing decision (1–3) |
| `PATCH` | `/api/chat/conversations/{id}` | Rename a conversation |
| `POST` | `/api/chat/sessions/{id}/end` | End a session |
| `DELETE` | `/api/chat/sessions/{id}` | Delete an ended session (audit records are preserved) |
| `GET` | `/api/chat/conversations` | Paginated conversation list with aggregated stats |
| `GET` | `/api/chat/conversations/{id}` | Conversation detail with sessions |
| `POST` | `/api/chat/conversations/{id}/sessions` | Restart a conversation (create a new session) |

---

## Docker Compose

```bash
cp .env.example .env   # set OPENROUTER_API_KEY and JWT_SECRET
docker compose up --build
```

- API: http://localhost:8000  
- UI: http://localhost:3000  

Data is persisted in `./data` via a volume mount.

---

## First-time setup

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| [uv](https://docs.astral.sh/uv/) | latest | `curl -LsSf https://astral.sh/uv/install.sh \| sh` (macOS/Linux) or `winget install astral-sh.uv` (Windows) |
| [Node.js](https://nodejs.org/) | 18+ | [nodejs.org](https://nodejs.org/) or via `nvm` |

Python 3.13 is managed automatically by uv — no separate installation needed.

### 1. Install dependencies

```sh
# Python backend
uv sync

# Frontend
cd src/frontend
npm install
cd ../..
```

### 2. Configure your API key

**Option A — environment file (quickest)**

```sh
# macOS / Linux
cp .env.example .env       # or create it manually if .env.example is absent

# Edit the file and add your key
# OPENROUTER_API_KEY=sk-or-v1-...
```

On Windows (PowerShell):
```powershell
Copy-Item .env.example .env    # skip if file already exists
notepad .env
```

**Option B — Settings UI (recommended)**

Start the app first (step 4 below), then go to **Settings → API Keys** and add a key there. Keys stored via the UI are persisted in the database and can be managed without touching `.env`.

Get your key at [openrouter.ai/keys](https://openrouter.ai/keys).

### 3. Seed model pricing

Fetch the latest model catalogue from OpenRouter (required before using Chat or Invoke):

```sh
uv run python scripts/fetch_models.py
```

This populates the `model_pricing` table. You can re-run this at any time to refresh pricing, or use **Settings → Model Sync** in the web UI.

### 4. Start the servers

Open two terminals:

**Terminal 1 — API server** (port 8000):
```sh
uv run llm-explorer-api
```

**Terminal 2 — Web UI** (port 3000):
```sh
cd src/frontend
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

The SQLite database is created automatically at `data/llm_explorer.db` on first start.

## Security / threat model (local-first)

- Designed for **localhost** use by a single user on their own machine.
- API keys in SQLite are **encrypted at rest** (Fernet; key derived from `ENCRYPTION_KEY` or `JWT_SECRET`).
- Auth uses a JWT in an **HttpOnly cookie** (with CSRF token for cookie-based mutating requests). The UI also keeps a Bearer token in `localStorage` for API clients that do not send cookies.
- Default API bind address is **`127.0.0.1`** (`API_HOST`); do not expose to untrusted networks without TLS and further hardening.
- JWT signing secret: `JWT_SECRET` env var, or `data/jwt_secret.txt` via an explicit admin endpoint.

See [docs/architecture.md](docs/architecture.md) and [docs/code_review.md](docs/code_review.md) for design detail.

---

## Running

### Web UI

Start both servers as shown above. The sidebar links to:

| Page | Description |
|---|---|
| Dashboard | Total cost, token count, query count, and recent activity |
| Chat | Multi-turn conversation with model switching and file uploads |
| History | Browse conversations; expand sessions; view messages; download PDF |
| Invoke | Single-turn playground |
| Usage | Full audit log of every LLM call |
| Models | Model catalogue with pricing; sync from OpenRouter |
| Credits | Credit balance and transaction ledger |
| Settings | API key management and model sync |

### CLI (single-turn, no web UI required)

```sh
uv run llm-explorer "What is the meaning of life?"

uv run llm-explorer "Explain quantum entanglement" \
  --provider meta-llama \
  --model llama-3.3-70b-instruct
```

---

## Usage guide

### Starting a chat

1. Go to **Chat** and select a provider and model
2. Click **Start Chat** — this creates a new conversation and its first session
3. Type a message and press **Enter** (or **Shift+Enter** for a new line)
4. Switch provider/model at any time using the dropdowns in the input bar; hover a model name to see its context size and pricing

### Attaching files

Click the paperclip icon in the input bar to attach images, PDFs, or text files. Files are sent to the model as part of the message and saved locally under `data/uploaded_data/`. Use a vision-capable model (e.g. `openai/gpt-4o`) for image analysis.

### Restarting a conversation

When a session ends, click **Restart Chat** on the summary screen to open a new session within the same conversation. The LLM will have access to the entire prior message history. Click **New Conversation** instead to start completely fresh.

You can also restart from **History → View Sessions → Restart**.

### Downloading a chat as PDF

In **History**, click **View Sessions** on a conversation, then **View Chat** on a session, then **Download PDF**. This opens a formatted print preview; save as PDF using the browser's print dialog (`Ctrl+P` / `Cmd+P`).

### Managing API keys

Go to **Settings → API Keys**. You can:
- Add keys with a custom name and provider label
- Activate any stored key (deactivates the previous one)
- Delete keys you no longer need

Only one key is active at a time. If no key is active, the server falls back to the `OPENROUTER_API_KEY` environment variable.

### Currency display

On the **Credits** page, select a display currency from the dropdown (GBP, EUR, INR, CNY, JPY, AUD). Amounts are shown as `$USD (local)`. Rates are fetched once per calendar day from `open.er-api.com` and cached; no API key is required.

---

## Development

### Running tests

```sh
uv run pytest
uv run pytest --cov=src/backend      # with coverage report
```

### Lint and type check

```sh
uv run ruff check src/ tests/
uv run mypy src/
```

### Frontend type check

```sh
cd src/frontend
npx tsc --noEmit
```

### Project structure (backend)

| Path | Purpose |
|---|---|
| `api.py` / `http/app.py` | FastAPI factory, middleware, lifespan |
| `http/routers/` | REST route modules (chat, models, usage, auth, …) |
| `use_cases/chat/` | Chat pipeline: prepare, stream, finalize |
| `use_cases/answering_agent.py` | Answering LLM (Agents SDK) |
| `use_cases/router_agent.py` | Router LLM with structured output |
| `use_cases/agent_client.py` | OpenAI clients, streaming, costs |
| `repos/` | Data access (`chat_repo`, `settings_repo`) |
| `audit_service.py` | `usage_audit` + `expense_log` + JSONL |
| `credit_service.py` | Wallet ledger (`balance` table) |
| `init_db.py` | Schema creation and idempotent migrations |

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | — | API key for OpenRouter (fallback if no DB key is active) |
| `API_HOST` | `127.0.0.1` | Uvicorn bind address |
| `API_PORT` | `8000` | Uvicorn port |
| `API_RELOAD` | `1` | Hot reload (`0` to disable) |
| `JWT_SECRET` | — | JWT signing + encryption key derivation |
| `ENCRYPTION_KEY` | — | Optional override for API key encryption at rest |

All data paths are relative to the project root and resolved in `config.py`:

| Path | Description |
|---|---|
| `data/llm_explorer.db` | SQLite database |
| `data/llm_usage_log.jsonl` | Append-only JSONL audit log (successful calls only) |
| `data/models.csv` | Optional local model pricing cache |
| `data/uploaded_data/` | Files attached in multi-modal chat messages |
