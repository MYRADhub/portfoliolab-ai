# PortfolioLab AI — System Requirements & Installation Guide

This document provides complete instructions for setting up the environment, installing dependencies, configuring environment variables, and running the **PortfolioLab AI** monorepo.

---

## 1. System Requirements & Prerequisites

Before setting up the project, ensure your local development machine meets the following baseline requirements:

| Tool / Runtime | Required Version | Purpose |
| :--- | :--- | :--- |
| **Node.js** | `>= 18.18.0` (LTS recommended) | Primary JavaScript/TypeScript execution runtime |
| **pnpm** | `>= 8.0.0` | Workspace package manager |
| **PostgreSQL** | `>= 15.0` | Core relational database |
| **Git** | `>= 2.30.0` | Version control |
| **Python** *(Optional)* | `>= 3.10` | Quantitative modeling and auxiliary data pipelines |

---

## 2. Project Architecture & Workspace Structure

The project is structured as a **pnpm monorepo**:

* `apps/web` — Next.js front-end dashboard (React 18, Tailwind CSS, Lucide Icons, Radix UI).
* `packages/data` — Financial data retrieval pipelines (Yahoo Finance, Finnhub, SEC EDGAR).
* `packages/classify` — AI classification engine and factor modeling (OpenAI SDK / LLMs).
* `packages/db` — Database schemas, migrations, and ORM abstractions (Drizzle ORM + PostgreSQL).

---

## 3. Environment Configuration (`.env`)

Create a `.env` file in the root directory of the repository with the following environment variables:

```env
# Node Environment
NODE_ENV=development

# Core Database (PostgreSQL)
DATABASE_URL=postgres://postgres:password@localhost:5432/portfoliolab_db

# AI & LLM Provider Settings
OPENAI_API_KEY=sk-your-openai-api-key

# Financial Data Providers
FINNHUB_API_KEY=your_finnhub_api_key
SEC_EDGAR_USER_AGENT=YourName admin@yourdomain.com

# NextAuth / Application Auth (If required)
NEXTAUTH_SECRET=your_generated_secret_key
NEXTAUTH_URL=http://localhost:3000
```

---

## 4. Quick Start & Installation Steps

### Step 1: Install Global Dependencies
Ensure `pnpm` is installed globally:
```bash
npm install -g pnpm
```

### Step 2: Clone the Repository
```bash
git clone https://github.com/your-org/portfoliolab-ai.git
cd portfoliolab-ai
```

### Step 3: Install Workspace Dependencies
Install all package dependencies across all workspaces:
```bash
pnpm install
```

### Step 4: Database Setup & Migrations
Ensure PostgreSQL is active, create the database specified in `DATABASE_URL`, and apply schemas:

```bash
# Push schema directly to your local database (Development)
pnpm --filter db db:push

# Generate migration scripts (Production/Staging)
pnpm --filter db db:generate

# Execute pending migrations
pnpm --filter db db:migrate
```

### Step 5: Start Development Servers
Run the full monorepo in development mode:
```bash
pnpm dev
```

To run only the web interface:
```bash
pnpm --filter web dev
```

Open your browser and navigate to `http://localhost:3000`.

---

## 5. Verification & Testing

```bash
# Run TypeScript compilation and build checks across all packages
pnpm build

# Run code style & linting checks
pnpm lint

# Run Playwright End-to-End tests
pnpm --filter web test:e2e
```

---

## 6. Python Environment Setup (Optional)

If you are using Python for data analysis, scraping, or machine learning pipelines alongside the Node.js project, use the following setup:

### Create Virtual Environment
```bash
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### Python Dependencies
```text
# --- Math & Data Processing ---
numpy>=1.26.0
pandas>=2.2.0
scipy>=1.12.0
scikit-learn>=1.4.0

# --- Financial Data & Scrapers ---
yfinance>=0.2.36
sec-edgar-downloader>=5.0.0
httpx>=0.27.0
requests>=2.31.0

# --- AI & Utilities ---
openai>=1.12.0
pydantic>=2.6.0
tiktoken>=0.6.0
python-dotenv>=1.0.1

# --- Database & Testing ---
psycopg2-binary>=2.9.9
sqlalchemy>=2.0.27
pytest>=8.0.0
```
