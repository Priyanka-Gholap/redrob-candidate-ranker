import json
import os
import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from datetime import datetime
import time
import re

# Present date in the dataset
PRESENT_DATE = datetime(2026, 5, 27)

# Consulting firms list (disqualifiers if career is services-only)
CONSULTING_FIRMS = {
    'tcs', 'tata consultancy services', 'infosys', 'wipro', 'accenture', 'cognizant', 
    'capgemini', 'tech mahindra', 'hcl', 'hcltech', 'l&t', 'lnt', 'mindtree', 'mphasis'
}

# Default Job Description text to embed
DEFAULT_JD = (
    "Senior AI Engineer, Founding Team. Redrob AI. Series A AI-native talent intelligence platform. "
    "Pune/Noida, India. 5-9 years of experience. Modern ML systems: embeddings, retrieval, ranking, LLMs, "
    "fine-tuning, RAG, vector search, semantic search. Software development, strong Python. Hybrid search "
    "infrastructure: Pinecone, Weaviate, Qdrant, Milvus, OpenSearch, Elasticsearch, FAISS. Designing "
    "evaluation frameworks: NDCG, MRR, MAP. Product engineering attitude, shipping code, product company."
)

app = FastAPI(title="Redrob Candidate Ranker API")

# Enable CORS for the Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables to cache data
candidates_by_id = {}
active_candidates = []
honeypots = set()
model = None
title_word_index = {}
skills_word_index = {}

# New cache variables for instant response
candidate_embeddings = None
retrieved_candidates_1000 = []
default_semantic_scores = None
default_jd_vector = None

# Path relative to script location
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
candidates_path = os.path.join(BASE_DIR, "data", "[PUB] India_runs_data_and_ai_challenge", "India_runs_data_and_ai_challenge", "candidates.jsonl")

class WeightsConfig(BaseModel):
    semantic: float = 1.5       # weight for semantic similarity fit
    experience: float = 1.0     # weight for experience sweet spot
    location: float = 1.0       # weight for location/relocation willing
    notice: float = 1.0         # weight for notice period
    activity: float = 1.0       # weight for platform activity
    consulting: float = 1.0     # weight of penalty for services-only company careers (1.0 = full penalty, 0.0 = no penalty)
    role: float = 1.0           # weight for title match

class RankRequest(BaseModel):
    weights: WeightsConfig
    jd_text: Optional[str] = None

class JDUpdate(BaseModel):
    text: str

@app.on_event("startup")
def startup_event():
    global candidates_by_id, active_candidates, honeypots, model
    global candidate_embeddings, retrieved_candidates_1000, default_semantic_scores, default_jd_vector
    global title_word_index, skills_word_index
    
    print("API Startup: Loading dataset...")
    start_time = time.time()
    
    if not os.path.exists(candidates_path):
        print(f"API WARNING: Candidates file not found at {candidates_path}. API endpoints will fail.")
        return
        
    # 1. Load candidates and identify honeypots
    print("API Startup: Loading candidates and identifying honeypots...")
    with open(candidates_path, 'r', encoding='utf-8') as f:
        for line in f:
            if not line.strip():
                continue
            cand = json.loads(line)
            cid = cand["candidate_id"]
            candidates_by_id[cid] = cand
            
            # Identify honeypots
            profile = cand["profile"]
            history = cand["career_history"]
            skills = cand["skills"]
            
            is_honeypot = False
            
            # Check 1: Expert/Advanced skill with 0 duration
            for s in skills:
                if s["proficiency"] in ["expert", "advanced"] and s.get("duration_months", 0) == 0:
                    is_honeypot = True
                    break
            
            if not is_honeypot:
                # Check 2: Experience discrepancy
                total_exp = profile.get("years_of_experience", 0)
                history_months = sum(job.get("duration_months", 0) for job in history)
                history_years = history_months / 12.0
                if abs(total_exp - history_years) > 1.0:
                    is_honeypot = True
                    
            if not is_honeypot:
                # Check 3: Job-level date anomalies
                for job in history:
                    start = job.get("start_date")
                    end = job.get("end_date")
                    dur = job.get("duration_months", 0)
                    
                    try:
                        start_dt = datetime.strptime(start, "%Y-%m-%d")
                        if end:
                            end_dt = datetime.strptime(end, "%Y-%m-%d")
                            expected_months = (end_dt.year - start_dt.year) * 12 + (end_dt.month - start_dt.month)
                            if abs(dur - expected_months) > 2:
                                is_honeypot = True
                                break
                        else:
                            expected_months = (PRESENT_DATE.year - start_dt.year) * 12 + (PRESENT_DATE.month - start_dt.month)
                            if dur > expected_months + 2:
                                is_honeypot = True
                                break
                    except Exception:
                        is_honeypot = True
                        break
                        
            if is_honeypot:
                honeypots.add(cid)
            else:
                active_candidates.append(cand)
                
    print(f"API Startup: Loaded {len(candidates_by_id)} candidates. Blacklisted {len(honeypots)} honeypots. {len(active_candidates)} active.")
    
    # Build word indexes
    print("API Startup: Building word indexes for fast candidate retrieval...")
    title_word_index = {}
    skills_word_index = {}
    for idx, cand in enumerate(active_candidates):
        title = cand["profile"].get("current_title", "").lower()
        title_words = re.findall(r'[a-z0-9+#]+', title)
        for w in set(title_words):
            if w not in title_word_index:
                title_word_index[w] = []
            title_word_index[w].append(idx)
            
        skills_str = " ".join(s["name"].lower() for s in cand["skills"])
        skills_words = re.findall(r'[a-z0-9+#]+', skills_str)
        for w in set(skills_words):
            if w not in skills_word_index:
                skills_word_index[w] = []
            skills_word_index[w].append(idx)
    print(f"API Startup: Word indexes built successfully.")
    
    # 2. Perform retrieval of top 1000 candidates
    print("API Startup: Selecting top 1000 candidates for semantic caching...")
    retrieved_candidates_1000 = retrieve_top_candidates(active_candidates, limit=1000)
    
    # Paths for cached embeddings
    embeddings_cache_dir = os.path.join(BASE_DIR, "data")
    embeddings_cache_path = os.path.join(embeddings_cache_dir, "top_1000_embeddings.npy")
    
    # 3. Check for cached embeddings
    if os.path.exists(embeddings_cache_path):
        print(f"API Startup: Loading cached embeddings from {embeddings_cache_path}...")
        candidate_embeddings = np.load(embeddings_cache_path)
        print(f"API Startup: Loaded embeddings shape {candidate_embeddings.shape}.")
        
        # Load Sentence Transformer model
        print("API Startup: Loading SentenceTransformer...")
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer('all-MiniLM-L6-v2')
    else:
        print("API Startup: No cached embeddings found. Initializing SentenceTransformer to compute them...")
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer('all-MiniLM-L6-v2')
        
        # Prepare profile texts for the 1000 candidates
        texts = []
        for cand in retrieved_candidates_1000:
            profile = cand["profile"]
            skills = cand["skills"]
            history = cand["career_history"]
            
            skills_str = ", ".join(s["name"] for s in skills)
            hist_parts = []
            for job in history[:3]:
                hist_parts.append(f"Role: {job.get('title', '')} at {job.get('company', '')}. {job.get('description', '')}")
            hist_str = " ".join(hist_parts)
            
            text = f"Title: {profile.get('current_title', '')}. Headline: {profile.get('headline', '')}. Summary: {profile.get('summary', '')}. Skills: {skills_str}. Experience: {hist_str}"
            texts.append(text)
            
        print("API Startup: Encoding candidate texts (takes ~40 seconds)...")
        candidate_embeddings = model.encode(texts, batch_size=128, convert_to_numpy=True, show_progress_bar=False)
        norms = np.linalg.norm(candidate_embeddings, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        candidate_embeddings = candidate_embeddings / norms
        
        # Save to cache
        print(f"API Startup: Saving computed embeddings to cache at {embeddings_cache_path}...")
        os.makedirs(embeddings_cache_dir, exist_ok=True)
        np.save(embeddings_cache_path, candidate_embeddings)
        
    # 4. Precompute default JD embedding and base semantic scores
    print("API Startup: Precomputing default JD embedding...")
    default_jd_vector = model.encode(DEFAULT_JD, convert_to_numpy=True)
    default_jd_vector = default_jd_vector / np.linalg.norm(default_jd_vector)
    
    default_semantic_scores = np.dot(candidate_embeddings, default_jd_vector)
    
    print(f"API Startup: Ready in {time.time() - start_time:.2f} seconds!")

@app.get("/api/status")
def get_status():
    return {
        "status": "ready" if len(candidates_by_id) > 0 else "error",
        "candidates_count": len(candidates_by_id),
        "honeypots_count": len(honeypots),
        "active_count": len(active_candidates)
    }

def retrieve_top_candidates(candidates, limit=1000):
    """
    Performs a fast keyword relevance check to select the top candidates for semantic reranking.
    This reduces the database from 100,000 to the top 1,000 matches in under 1 second.
    """
    target_terms = {
        "embedding", "retrieval", "vector", "search", "rag", "llm", "nlp", "python", 
        "machine learning", "ranking", "transformers", "pytorch", "tensorflow", "bert",
        "semantic", "indexing", "pinecone", "weaviate", "qdrant", "milvus", "faiss"
    }
    
    scored_candidates = []
    
    for cand in candidates:
        profile = cand["profile"]
        skills = cand["skills"]
        history = cand["career_history"]
        
        score = 0.0
        
        # 1. Current title check
        title = profile.get("current_title", "").lower()
        for term in target_terms:
            if term in title:
                score += 5.0
                
        # 2. Skills check
        for s in skills:
            sname = s["name"].lower()
            for term in target_terms:
                if term in sname:
                    score += 2.0
                    
        # 3. Headline & Summary check
        headline = profile.get("headline", "").lower()
        summary = profile.get("summary", "").lower()
        for term in target_terms:
            if term in headline:
                score += 1.0
            if term in summary:
                score += 0.5
                
        # 4. Career History check (last 3 jobs)
        for job in history[:3]:
            jtitle = job.get("title", "").lower()
            jdesc = job.get("description", "").lower()
            for term in target_terms:
                if term in jtitle:
                    score += 1.0
                if term in jdesc:
                    score += 0.2
                    
        scored_candidates.append((score, cand))
        
    scored_candidates.sort(key=lambda x: -x[0])
    return [cand for _, cand in scored_candidates[:limit]]

def compute_dynamic_multipliers(cand, weights: WeightsConfig):
    """
    Computes candidate score multipliers dynamically using custom weights.
    """
    profile = cand["profile"]
    history = cand["career_history"]
    signals = cand["redrob_signals"]
    
    # 1. Experience Fit
    exp = profile.get("years_of_experience", 0)
    if 5 <= exp <= 9:
        raw_exp_mult = 1.3 if 6 <= exp <= 8 else 1.1
    elif exp < 3 or exp > 15:
        raw_exp_mult = 0.5
    else:
        raw_exp_mult = 0.9
    exp_mult = 1.0 + (raw_exp_mult - 1.0) * weights.experience
    
    # 2. Location
    loc = profile.get("location", "").lower()
    willing_relocate = signals.get("willing_to_relocate", False)
    preferred_cities = ["pune", "noida", "delhi", "gurgaon", "hyderabad", "mumbai", "bangalore"]
    in_preferred_city = any(city in loc for city in preferred_cities)
    
    if in_preferred_city:
        raw_loc_mult = 1.2
    elif willing_relocate:
        raw_loc_mult = 1.0
    else:
        raw_loc_mult = 0.4
    loc_mult = 1.0 + (raw_loc_mult - 1.0) * weights.location
    
    # 3. Notice Period
    notice = signals.get("notice_period_days", 0)
    if notice <= 30:
        raw_notice_mult = 1.2
    elif notice <= 90:
        raw_notice_mult = 1.0
    else:
        raw_notice_mult = 0.5
    notice_mult = 1.0 + (raw_notice_mult - 1.0) * weights.notice
    
    # 4. Platform Activity & Response
    active_str = signals.get("last_active_date")
    active_mult = 1.0
    if active_str:
        try:
            active_dt = datetime.strptime(active_str, "%Y-%m-%d")
            days_inactive = (PRESENT_DATE - active_dt).days
            if days_inactive <= 30:
                active_mult = 1.2
            elif days_inactive > 180:
                active_mult = 0.4
            elif days_inactive > 90:
                active_mult = 0.7
        except Exception:
            pass
            
    response_rate = signals.get("recruiter_response_rate", 0.0)
    if response_rate > 0.8:
        response_mult = 1.2
    elif response_rate < 0.2:
        response_mult = 0.5
    else:
        response_mult = 1.0
        
    open_work_mult = 1.1 if signals.get("open_to_work_flag", False) else 1.0
    raw_activity_mult = active_mult * response_mult * open_work_mult
    activity_mult = 1.0 + (raw_activity_mult - 1.0) * weights.activity
    
    # 5. Consulting Firm Penalty
    has_history = len(history) > 0
    all_consulting = has_history
    for job in history:
        comp = job.get("company", "").lower()
        is_consulting = any(c in comp for c in CONSULTING_FIRMS)
        if not is_consulting:
            all_consulting = False
            break
            
    raw_consulting_penalty = 0.1 if (has_history and all_consulting) else 1.0
    consulting_penalty = 1.0 - (1.0 - raw_consulting_penalty) * weights.consulting
    
    # 6. Role Title
    current_title = profile.get("current_title", "").lower()
    non_tech_keywords = [
        "marketing", "sales", "hr", "recruiter", "finance", "writer", 
        "product manager", "pm", "designer", "scrum master", "analyst", 
        "teacher", "academic", "student"
    ]
    is_non_tech = any(kw in current_title for kw in non_tech_keywords)
    tech_keywords = ["ai", "ml", "machine learning", "backend", "software", "developer", "engineer", "data engineer"]
    is_tech = any(kw in current_title for kw in tech_keywords)
    
    if is_non_tech:
        raw_role_mult = 0.1
    elif is_tech:
        raw_role_mult = 1.2
    else:
        raw_role_mult = 1.0
    role_mult = 1.0 + (raw_role_mult - 1.0) * weights.role
    
    total_mult = exp_mult * loc_mult * notice_mult * activity_mult * consulting_penalty * role_mult
    
    return total_mult, {
        "experience": exp_mult,
        "location": loc_mult,
        "notice": notice_mult,
        "activity": activity_mult,
        "consulting": consulting_penalty,
        "role": role_mult
    }

def parse_jd_requirements(jd_text: str):
    import re
    # Defaults (tuned for Senior AI Engineer if no JD is passed or found)
    min_exp = 5.0
    max_exp = 9.0
    preferred_cities = ["pune", "noida", "delhi", "gurgaon", "hyderabad", "mumbai", "bangalore"]
    target_titles = ["ai", "ml", "machine learning", "deep learning", "nlp", "vision", "search", "retrieval", "rag", "embeddings"]
    
    if not jd_text or not jd_text.strip():
        return min_exp, max_exp, preferred_cities, target_titles
        
    jd_lower = jd_text.lower()
    
    # 1. Parse experience range
    # Look for "X-Y years", "X to Y years", "X+ years", "X years", etc.
    exp_patterns = [
        r'(\d+)\s*(?:-|to)\s*(\d+)\s*(?:years|yrs|yoe|year\s+of\s+experience)',
        r'(\d+)\s*\+\s*(?:years|yrs|yoe|year\s+of\s+experience)',
        r'(?:minimum|at least|required)\s*(?:of)?\s*(\d+)\s*(?:years|yrs|yoe|year\s+of\s+experience)'
    ]
    
    for pat in exp_patterns:
        matches = re.findall(pat, jd_lower)
        if matches:
            try:
                if isinstance(matches[0], tuple) and len(matches[0]) == 2 and matches[0][1]:
                    min_exp = float(matches[0][0])
                    max_exp = float(matches[0][1])
                else:
                    val = float(matches[0] if isinstance(matches[0], str) else matches[0][0])
                    min_exp = val
                    max_exp = val + 4.0 # Default upper bound buffer
                break
            except Exception:
                pass
                
    # 2. Parse location preference
    tech_cities = ["pune", "noida", "delhi", "gurgaon", "hyderabad", "mumbai", "bangalore", "chennai", "kolkata"]
    found_cities = [city for city in tech_cities if city in jd_lower]
    if found_cities:
        preferred_cities = found_cities
        
    # 3. Parse target title / role keywords
    # Try to extract the title from the first few lines of the JD
    extracted_title = None
    lines = [line.strip() for line in jd_text.split('\n') if line.strip()]
    for line in lines[:3]:
        match = re.match(r'^(?:job\s+description|job\s+title|role|position|title)\s*:\s*(.*)$', line, re.IGNORECASE)
        if match:
            extracted_title = match.group(1).strip()
            break
    if not extracted_title and lines:
        first_line = lines[0]
        if len(first_line) < 100 and not any(first_line.lower().startswith(x) for x in ["we are", "requirements", "experience"]):
            extracted_title = first_line
            
    if extracted_title:
        # Clean title: remove suffixes and common prefixes
        cleaned = re.sub(r'\s*[\-—–:|].*$', '', extracted_title)
        cleaned = cleaned.lower()
        prefixes = ["senior", "junior", "lead", "staff", "principal", "founding", "associate"]
        for p in prefixes:
            cleaned = re.sub(r'\b' + p + r'\b', '', cleaned)
        cleaned = cleaned.strip()
        
        # Tokenize
        words = re.findall(r'[a-z0-9+#]+', cleaned)
        stop_words = {"and", "or", "of", "in", "to", "for", "with", "the", "a", "an", "at", "by", "on"}
        
        target_titles = []
        if len(words) > 1:
            target_titles.append(cleaned)
            
        for w in words:
            if w not in stop_words and len(w) >= 2:
                target_titles.append(w)
                
        if not target_titles:
            target_titles = [cleaned] if cleaned else ["ai", "ml"]
    else:
        role_kws = [
            "ai", "ml", "machine learning", "deep learning", "nlp", "vision", 
            "search", "retrieval", "rag", "embeddings",
            "java", "python", "c++", "c#", "backend", "frontend", "fullstack", "full stack",
            "software engineer", "software developer", "data engineer", "data scientist",
            "devops", "cloud", "android", "ios", "react"
        ]
        found_roles = []
        for kw in role_kws:
            if re.search(r'\b' + re.escape(kw) + r'\b', jd_lower):
                found_roles.append(kw)
        if found_roles:
            target_titles = found_roles
            
    return min_exp, max_exp, preferred_cities, target_titles

@app.post("/api/rank")
def rank_candidates(request: RankRequest):
    global model, active_candidates, candidate_embeddings, retrieved_candidates_1000, default_semantic_scores, default_jd_vector
    
    weights = request.weights
    jd_text = request.jd_text
    
    if not active_candidates:
        raise HTTPException(status_code=503, detail="Dataset is empty or not loaded.")
        
    query_text = jd_text or DEFAULT_JD
    
    # 1. Determine if we can use cached embeddings and semantic scores
    is_default_jd = (query_text.strip() == DEFAULT_JD.strip())
    
    # Parse requirements from JD text
    min_exp, max_exp, preferred_cities, target_titles = parse_jd_requirements(query_text)
    
    if is_default_jd and default_semantic_scores is not None:
        # Instant path: use precomputed default semantic scores
        semantic_scores = default_semantic_scores
        retrieved_candidates = retrieved_candidates_1000
    else:
        # Dynamic path: encode the single custom JD string and score against the cached 1000 candidate embeddings
        if model is None:
            from sentence_transformers import SentenceTransformer
            model = SentenceTransformer('all-MiniLM-L6-v2')
            
        jd_vector = model.encode(query_text, convert_to_numpy=True)
        jd_vector = jd_vector / np.linalg.norm(jd_vector)
        
        # Multiply with cached embeddings of the 1000 candidates
        semantic_scores = np.dot(candidate_embeddings, jd_vector)
        retrieved_candidates = retrieved_candidates_1000
        
    # 2. Rerank candidates using raw 0-100 criteria scores and importance weights
    scored_candidates = []
    
    # Calculate sum of weights for normalization
    w_exp = max(0.0, weights.experience)
    w_loc = max(0.0, weights.location)
    w_notice = max(0.0, weights.notice)
    w_activity = max(0.0, weights.activity)
    w_consulting = max(0.0, weights.consulting)
    w_role = max(0.0, weights.role)
    w_sem = max(0.0, getattr(weights, "semantic", 1.5)) # dynamic semantic weight
    
    w_total = w_sem + w_exp + w_loc + w_notice + w_activity + w_consulting + w_role
    if w_total <= 0.0:
        w_total = 1.0
        
    for idx, cand in enumerate(retrieved_candidates):
        cid = cand["candidate_id"]
        profile = cand["profile"]
        history = cand["career_history"]
        signals = cand["redrob_signals"]
        
        # Criterion 1: Semantic Match Score (0 - 100)
        similarity = float(semantic_scores[idx])
        sem_score = max(0.0, min(100.0, (similarity - 0.15) / 0.25 * 100.0))
        
        # Criterion 2: Experience Fit Score (0 - 100)
        exp = profile.get("years_of_experience", 0)
        if min_exp <= exp <= max_exp:
            exp_score = 100.0
        elif (min_exp - 1.0) <= exp < min_exp or max_exp < exp <= (max_exp + 2.0):
            exp_score = 70.0
        elif (min_exp - 2.0) <= exp < (min_exp - 1.0) or (max_exp + 2.0) < exp <= (max_exp + 4.0):
            exp_score = 40.0
        else:
            exp_score = 10.0
            
        # Criterion 3: Location Fit Score (0 - 100)
        loc = profile.get("location", "").lower()
        willing_relocate = signals.get("willing_to_relocate", False)
        in_preferred_city = any(city in loc for city in preferred_cities)
        if in_preferred_city:
            loc_score = 100.0
        elif willing_relocate:
            loc_score = 80.0
        else:
            loc_score = 10.0
            
        # Criterion 4: Notice Period Score (0 - 100)
        notice = signals.get("notice_period_days", 0)
        if notice <= 15:
            notice_score = 100.0
        elif notice <= 30:
            notice_score = 80.0
        elif notice <= 60:
            notice_score = 50.0
        elif notice <= 90:
            notice_score = 30.0
        else:
            notice_score = 0.0
            
        # Criterion 5: Platform Activity Score (0 - 100)
        active_str = signals.get("last_active_date")
        active_score = 20.0
        if active_str:
            try:
                active_dt = datetime.strptime(active_str, "%Y-%m-%d")
                days_inactive = (PRESENT_DATE - active_dt).days
                if days_inactive <= 30:
                    active_score += 30.0
                elif days_inactive <= 90:
                    active_score += 15.0
            except Exception:
                pass
        response_rate = signals.get("recruiter_response_rate", 0.0)
        active_score += response_rate * 40.0
        if signals.get("open_to_work_flag", False):
            active_score += 10.0
        active_score = max(0.0, min(100.0, active_score))
        
        # Criterion 6: Consulting firm vs Product Pedigree Score (0 - 100)
        has_history = len(history) > 0
        all_consulting = has_history
        any_consulting = False
        for job in history:
            comp = job.get("company", "").lower()
            is_consult = any(c in comp for c in CONSULTING_FIRMS)
            if is_consult:
                any_consulting = True
            else:
                all_consulting = False
                
        if has_history and all_consulting:
            pedigree_score = 10.0
        elif any_consulting:
            pedigree_score = 60.0
        else:
            pedigree_score = 100.0
            
        # Criterion 7: Role Title Score (0 - 100)
        current_title = profile.get("current_title", "").lower()
        non_tech_keywords = [
            "marketing", "sales", "hr", "recruiter", "finance", "writer", 
            "product manager", "pm", "designer", "scrum master", "analyst", 
            "teacher", "academic", "student"
        ]
        
        # Ensure we don't penalize a keyword as non-tech if it is the target role title itself!
        active_non_tech = [kw for kw in non_tech_keywords if kw not in target_titles]
        is_non_tech = any(re.search(r'\b' + re.escape(kw) + r'\b', current_title) for kw in active_non_tech)
        
        general_words = {"engineer", "developer", "programmer", "analyst", "architect", "lead", "specialist", "manager", "officer", "consultant", "technician", "worker", "member", "associate", "head", "director"}
        exact_targets = [kw for kw in target_titles if kw not in general_words]
        
        if exact_targets:
            has_title_match = any(re.search(r'\b' + re.escape(kw) + r'\b', current_title) for kw in exact_targets)
        else:
            has_title_match = any(re.search(r'\b' + re.escape(kw) + r'\b', current_title) for kw in target_titles)
            
        general_tech_terms = ["engineer", "developer", "programmer", "analyst", "architect", "lead", "specialist"]
        is_general_tech = any(re.search(r'\b' + re.escape(kw) + r'\b', current_title) for kw in general_tech_terms)
        
        if is_non_tech:
            role_score = 10.0
        elif has_title_match:
            role_score = 100.0
        elif is_general_tech:
            role_score = 60.0
        else:
            role_score = 30.0
            
        # Compute Weighted Base Score (0 - 100)
        weighted_sum = (
            w_sem * sem_score +
            w_exp * exp_score +
            w_loc * loc_score +
            w_notice * notice_score +
            w_activity * active_score +
            w_consulting * pedigree_score +
            w_role * role_score
        )
        base_score = weighted_sum / w_total
        
        # Calculate tier-prioritized Final Score (0 - 100)
        final_score = 0.60 * role_score + 0.30 * exp_score + 0.10 * base_score
        
        scored_candidates.append({
            "candidate_id": cid,
            "profile": cand["profile"],
            "skills": cand["skills"],
            "career_history": cand["career_history"],
            "redrob_signals": cand["redrob_signals"],
            "semantic_score": round(sem_score, 1),
            "final_score": round(final_score, 1),
            "multipliers": {
                "semantic": round(sem_score, 0),
                "experience": round(exp_score, 0),
                "location": round(loc_score, 0),
                "notice": round(notice_score, 0),
                "activity": round(active_score, 0),
                "consulting": round(pedigree_score, 0),
                "role": round(role_score, 0)
            }
        })
        
    scored_candidates.sort(key=lambda x: (-x["final_score"], x["candidate_id"]))
    
    top_100 = scored_candidates[:100]
    
    from rank import generate_custom_reasoning
    for rank_idx, item in enumerate(top_100, 1):
        item["rank"] = rank_idx
        item["reasoning"] = generate_custom_reasoning(item, item["final_score"], rank_idx)
        
    return {
        "total_ranked": len(scored_candidates),
        "results": top_100
    }

@app.get("/api/candidate/{candidate_id}")
def get_candidate(candidate_id: str):
    if candidate_id not in candidates_by_id:
        raise HTTPException(status_code=404, detail="Candidate not found")
    
    cand = candidates_by_id[candidate_id]
    is_hp = candidate_id in honeypots
    
    return {
        "candidate": cand,
        "is_honeypot": is_hp
    }

@app.get("/api/compare")
def compare_keyword_vs_semantic(keyword: str = "RAG"):
    """
    Simulates a keyword match vs semantic match to show the difference on the dashboard.
    """
    keyword_matches = []
    
    # Search for keywords in active candidates
    for cand in active_candidates:
        profile = cand["profile"]
        skills_str = " ".join(s["name"].lower() for s in cand["skills"])
        summary = profile.get("summary", "").lower()
        headline = profile.get("headline", "").lower()
        
        if keyword.lower() in skills_str or keyword.lower() in summary or keyword.lower() in headline:
            keyword_matches.append(cand)
            if len(keyword_matches) >= 5:
                break
                
    # Get top 5 from semantic matching (using default weights)
    weights = WeightsConfig()
    rank_res = rank_candidates(RankRequest(weights=weights))
    semantic_matches = rank_res["results"][:5]
    
    # Format response
    kw_res = []
    for c in keyword_matches:
        kw_res.append({
            "candidate_id": c["candidate_id"],
            "name": c["profile"]["anonymized_name"],
            "title": c["profile"]["current_title"],
            "experience": c["profile"]["years_of_experience"],
            "skills": [s["name"] for s in c["skills"][:4]]
        })
        
    sem_res = []
    for r in semantic_matches:
        sem_res.append({
            "candidate_id": r["candidate_id"],
            "name": r["profile"]["anonymized_name"],
            "title": r["profile"]["current_title"],
            "experience": r["profile"]["years_of_experience"],
            "skills": [s["name"] for s in r["skills"][:4]],
            "score": r["final_score"],
            "reasoning": r["reasoning"]
        })
        
    return {
        "keyword": keyword,
        "keyword_results": kw_res,
        "semantic_results": sem_res
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend:app", host="0.0.0.0", port=8000, reload=False)
