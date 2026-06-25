# Redrob Intelligent Candidate Discovery & Ranking Platform

This repository contains a robust, AI-powered candidate discovery and ranking system designed for the **Senior AI Engineer — Founding Team** role. It is built as a submission for the **India Runs Data & AI Challenge** by Redrob AI.

Rather than relying on basic keyword filtering (which can easily be gamed by candidate resume keyword stuffers), our system utilizes a **local semantic retrieve-and-rerank engine** coupled with **recruiter heuristic multipliers** and a **blacklist logic check** to discover high-quality, highly active, and contextually matching profiles out of 100,000 candidates.

---

## 🛠 Project Structure

The project is cleanly divided into a Python backend service and a Next.js frontend application:

```text
redrob-candidate-ranker/
├── backend/
│   ├── data/                   # Dataset folder containing candidates.jsonl
│   ├── backend.py              # FastAPI Web API Server (starts on port 8000)
│   ├── rank.py                 # Core CLI ranking engine script
│   └── requirements.txt        # Backend dependencies
├── frontend/
│   ├── src/app/
│   │   ├── page.js             # Interactive Next.js Dashboard UI (starts on port 3000)
│   │   ├── globals.css         # Styling system (dark-mode, glassmorphism, responsive grid)
│   │   └── layout.js           # Page configuration
│   ├── package.json            # Node.js dependencies
│   └── next.config.mjs
├── run_app.py                  # Single-command startup helper script
├── submission.yaml             # Filled portal metadata specification
└── submission.csv              # Output list containing the 100 cleaned data rows
```

---

## 🚀 Quick Start (Run Both Servers in One Command)

To run the entire platform locally, make sure you have **Python (3.8+)** and **Node.js (v18+)** installed:

### 1. Install Backend Dependencies
Navigate to the `backend/` directory and install the requirements:
```bash
cd backend
pip install -r requirements.txt
cd ..
```

### 2. Run the Startup Script
From the root of the project, execute the helper script to run both servers concurrently:
```bash
python run_app.py
```
This script will:
1. Start the **FastAPI Backend** on [http://localhost:8000](http://localhost:8000). It loads the candidate database and the SentenceTransformer weights.
2. Start the **Next.js Frontend** on [http://localhost:3000](http://localhost:3000).

Open your browser and navigate to **[http://localhost:3000](http://localhost:3000)** to view the responsive recruiter dashboard!

---

## 🎯 Organizers Reproduction Command

For Stage 3 evaluation and code reproduction, you can run the ranking engine independently on a raw `candidates.jsonl` file. It will output the validated CSV containing exactly 100 candidates in **under 90 seconds on CPU**:

```bash
python backend/rank.py --candidates ./backend/data/[PUB] India_runs_data_and_ai_challenge/India_runs_data_and_ai_challenge/candidates.jsonl --out ./submission.csv
```

---

## 💡 AI Agent System Architecture

Our system handles candidate discovery through a sophisticated 5-layer pipeline:

### 1. Blacklist Logic Checks (Honeypot Filter)
The synthetic dataset contains ~80 honeypots with impossible profiles. We identify and blacklist them instantly using:
- **Skill Duration Checks:** Expert/Advanced skills with `duration_months == 0`.
- **Experience Discrepancy:** Stated years of experience vs sum of career history duration differs by > 1.0 year.
- **Timeline Violations:** Stated job duration exceeds the calendar time between the job start date and end date (or the present date `2026-05-27` if it's the current job).

### 2. Stage 1: Fast Retrieval (Keyword Term Index)
Running deep neural networks on all 100,000 candidates at query time is computationally infeasible on a CPU under 5 minutes. We build a fast term index in Python to score and retrieve the **top 1,000 matches** in **0.8 seconds**.

### 3. Stage 2: Semantic Reranking (SentenceTransformer)
We run the `all-MiniLM-L6-v2` transformer locally on CPU to embed the job description and the top 1,000 retrieved candidate profiles (headline, summary, skills, and top 3 jobs). Cosine similarities are computed to yield a base "semantic match score".

### 4. Stage 3: Recruiter Heuristic Multipliers
We apply multipliers on the semantic score to align matches with real-world recruiter preferences:
- **Consulting Firm Penalty:** Multiplier `0.1x` if the candidate has worked *only* at large IT service/consulting corporations (TCS, Infosys, Wipro, Accenture, Cognizant, etc.) to prioritize product engineering experience.
- **Experience Match:** Boosts candidates in the 5-9 year sweet spot (especially 6-8 years); penalizes junior and overly-senior profiles.
- **Location/Relocation:** Boosts Noida/Pune/NCR/Mumbai/Hyd/Blr and candidates willing to relocate; penalizes non-local, non-relocating candidates.
- **Notice Period:** Favors candidates with notice periods <= 30 days; down-weights periods > 90 days.
- **Engagement Signals:** Boosts active platform users and candidates with high recruiter response rates.

### 5. Stage 4: Unique Reasoning Generation
For the top 100, the system generates a 1-2 sentence custom, non-templated reasoning, citing specific facts (such as previous employers, matching skills, years of experience, and notice periods) to support the rank.
