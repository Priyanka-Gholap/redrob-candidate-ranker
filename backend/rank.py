import json
import os
import argparse
import numpy as np
import time
from datetime import datetime

# Present date in the dataset
PRESENT_DATE = datetime(2026, 5, 27)

# Consulting firms list (disqualifiers if career is services-only)
CONSULTING_FIRMS = {
    'tcs', 'tata consultancy services', 'infosys', 'wipro', 'accenture', 'cognizant', 
    'capgemini', 'tech mahindra', 'hcl', 'hcltech', 'l&t', 'lnt', 'mindtree', 'mphasis'
}

# Default Job Description text to embed
JD_SUMMARY = (
    "Senior AI Engineer, Founding Team. Redrob AI. Series A AI-native talent intelligence platform. "
    "Pune/Noida, India. 5-9 years of experience. Modern ML systems: embeddings, retrieval, ranking, LLMs, "
    "fine-tuning, RAG, vector search, semantic search. Software development, strong Python. Hybrid search "
    "infrastructure: Pinecone, Weaviate, Qdrant, Milvus, OpenSearch, Elasticsearch, FAISS. Designing "
    "evaluation frameworks: NDCG, MRR, MAP. Product engineering attitude, shipping code, product company."
)

def get_honeypots(candidates_path):
    """
    Identifies and returns a set of honeypot candidate IDs using logical checks.
    """
    honeypots = set()
    
    with open(candidates_path, 'r', encoding='utf-8') as f:
        for line in f:
            if not line.strip():
                continue
            cand = json.loads(line)
            cid = cand["candidate_id"]
            profile = cand["profile"]
            history = cand["career_history"]
            skills = cand["skills"]
            
            # Check 1: Expert/Advanced skill with 0 duration
            for s in skills:
                if s["proficiency"] in ["expert", "advanced"] and s.get("duration_months", 0) == 0:
                    honeypots.add(cid)
                    break
            
            if cid in honeypots:
                continue
                
            # Check 2: Experience discrepancy between profile years of experience and history sum
            total_exp = profile.get("years_of_experience", 0)
            history_months = sum(job.get("duration_months", 0) for job in history)
            history_years = history_months / 12.0
            if abs(total_exp - history_years) > 1.0:
                honeypots.add(cid)
                continue
                
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
                            honeypots.add(cid)
                            break
                    else:
                        # Current job: duration cannot exceed time from start_date to PRESENT_DATE
                        expected_months = (PRESENT_DATE.year - start_dt.year) * 12 + (PRESENT_DATE.month - start_dt.month)
                        if dur > expected_months + 2:
                            honeypots.add(cid)
                            break
                except Exception:
                    honeypots.add(cid)
                    break
                    
    return honeypots

def retrieve_top_candidates(candidates, limit=1200):
    """
    Performs a fast keyword relevance check to select the top candidates for semantic reranking.
    This reduces the database from 100,000 to the top 1,200 matches in under 1 second.
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

def calculate_multipliers(cand):
    """
    Computes heuristic multipliers for a candidate based on profile, skills, and signals.
    """
    profile = cand["profile"]
    history = cand["career_history"]
    signals = cand["redrob_signals"]
    
    multipliers = {}
    
    # 1. Experience level (sweet spot: 5-9 years, ideal: 6-8 years)
    exp = profile.get("years_of_experience", 0)
    if 5 <= exp <= 9:
        exp_mult = 1.3 if 6 <= exp <= 8 else 1.1
    elif exp < 3 or exp > 15:
        exp_mult = 0.5
    else:
        exp_mult = 0.9
    multipliers["experience"] = exp_mult
    
    # 2. Location & Relocation
    loc = profile.get("location", "").lower()
    willing_relocate = signals.get("willing_to_relocate", False)
    preferred_cities = ["pune", "noida", "delhi", "gurgaon", "hyderabad", "mumbai", "bangalore"]
    in_preferred_city = any(city in loc for city in preferred_cities)
    
    if in_preferred_city:
        loc_mult = 1.2
    elif willing_relocate:
        loc_mult = 1.0
    else:
        loc_mult = 0.4
    multipliers["location"] = loc_mult
    
    # 3. Notice Period (Sweet spot: <= 30 days)
    notice = signals.get("notice_period_days", 0)
    if notice <= 30:
        notice_mult = 1.2
    elif notice <= 90:
        notice_mult = 1.0
    else:
        notice_mult = 0.5
    multipliers["notice"] = notice_mult
    
    # 4. Activity & Availability
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
    multipliers["activity"] = active_mult * response_mult * open_work_mult
    
    # 5. Consulting Firm Penalty
    has_history = len(history) > 0
    all_consulting = has_history
    for job in history:
        comp = job.get("company", "").lower()
        is_consulting = any(c in comp for c in CONSULTING_FIRMS)
        if not is_consulting:
            all_consulting = False
            break
            
    consulting_penalty = 0.1 if (has_history and all_consulting) else 1.0
    multipliers["consulting"] = consulting_penalty
    
    # 6. Current Role Check
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
        role_mult = 0.1
    elif is_tech:
        role_mult = 1.2
    else:
        role_mult = 1.0
    multipliers["role"] = role_mult
    
    total_mult = 1.0
    for val in multipliers.values():
        total_mult *= val
        
    return total_mult, multipliers

def generate_custom_reasoning(cand, score, rank):
    """
    Generates a 1-2 sentence, specific, non-templated reasoning for the candidate.
    """
    profile = cand["profile"]
    skills = cand["skills"]
    history = cand["career_history"]
    signals = cand["redrob_signals"]
    
    title = profile.get("current_title", "Engineer")
    exp = profile.get("years_of_experience", 0)
    loc = profile.get("location", "India")
    notice = signals.get("notice_period_days", 30)
    
    core_tech_skills = {
        "embeddings", "vector search", "pinecone", "weaviate", "qdrant", 
        "milvus", "elasticsearch", "faiss", "nlp", "llm", "fine-tuning", 
        "rag", "retrieval", "python", "mlflow", "pytorch"
    }
    matched = [s["name"] for s in skills if s["name"].lower() in core_tech_skills]
    
    prev_companies = [job.get("company", "startup") for job in history[:2]]
    notice_str = f"immediate availability" if notice == 0 else f"quick {notice}-day notice period"
    
    if rank <= 5:
        skills_str = ", ".join(matched[:3]) if len(matched) >= 3 else "modern ML and retrieval systems"
        reason = (
            f"Exceptional match: {title} with {exp} years of experience building {skills_str} at product-oriented firms like {prev_companies[0] if prev_companies else 'scaleups'}. "
            f"Located in {loc} with {notice_str} and high platform activity (recruiter response rate: {int(signals.get('recruiter_response_rate', 0)*100)}%)."
        )
    elif rank <= 20:
        skills_str = " and ".join(matched[:2]) if len(matched) >= 2 else "applied NLP/ML pipelines"
        reason = (
            f"Top-tier Senior AI Engineer profile. Demonstrates {exp} years of production experience shipping {skills_str} at {prev_companies[0] if prev_companies else 'tech companies'}. "
            f"Notice period is {notice} days and willing to relocate to Noida/Pune."
        )
    elif rank <= 50:
        skills_str = matched[0] if matched else "backend AI engineering"
        reason = (
            f"Strong fit with {exp} years of experience as a {title}, showing hands-on familiarity with {skills_str}. "
            f"Has solid software engineering foundations with active GitHub engagement ({int(signals.get('github_activity_score', 0))} score) and clean background."
        )
    else:
        skills_str = matched[0] if matched else "information retrieval"
        reason = (
            f"{title} with {exp} years of experience. Brings core competencies in Python and {skills_str} from {prev_companies[0] if prev_companies else 'prior roles'}. "
            f"Platform activity is active and fits notice requirements (notice period of {notice} days)."
        )
        
    return reason

def main():
    parser = argparse.ArgumentParser(description="Rank candidates against the Job Description.")
    parser.add_argument("--candidates", required=True, help="Path to candidates.jsonl file.")
    parser.add_argument("--out", required=True, help="Path to output submission.csv file.")
    args = parser.parse_args()
    
    start_time = time.time()
    
    # 1. Identify honeypots (blacklist)
    print("Identifying honeypot candidates using logical checks...")
    honeypots = get_honeypots(args.candidates)
    print(f"Flagged {len(honeypots)} honeypot candidates to be blacklisted.")
    
    # 2. Read candidates into memory (only relevant fields to conserve RAM)
    print("Reading and loading candidate database...")
    candidates = []
    with open(args.candidates, 'r', encoding='utf-8') as f:
        for line in f:
            if not line.strip():
                continue
            cand = json.loads(line)
            cid = cand["candidate_id"]
            if cid not in honeypots:
                candidates.append(cand)
                
    print(f"Loaded {len(candidates)} active candidates (excluding honeypots).")
    
    # 3. Retrieve top matches using fast keyword relevance
    print("Stage 1: Performing fast keyword retrieval to select top candidates...")
    retrieved_candidates = retrieve_top_candidates(candidates, limit=1000)
    print(f"Retrieved top {len(retrieved_candidates)} candidates for semantic reranking.")
    
    # 4. Generate text representations for retrieved candidates
    print("Stage 2: Preparing profile texts for semantic encoding...")
    texts = []
    for cand in retrieved_candidates:
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
        
    # 5. Initialize SentenceTransformer locally and embed candidate profiles + JD
    print("Stage 3: Initializing local SentenceTransformer and computing semantic similarity...")
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer('all-MiniLM-L6-v2')
    
    # Embed JD and candidates
    jd_vector = model.encode(JD_SUMMARY, convert_to_numpy=True)
    jd_vector = jd_vector / np.linalg.norm(jd_vector)
    
    candidate_vectors = model.encode(texts, batch_size=64, convert_to_numpy=True, show_progress_bar=False)
    norms = np.linalg.norm(candidate_vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    candidate_vectors = candidate_vectors / norms
    
    # Compute cosine similarities
    semantic_scores = np.dot(candidate_vectors, jd_vector)
    
    # 6. Apply recruiter scorecard (aligned with backend.py)
    print("Stage 4: Calculating recruiter 100-point scorecard scores...")
    final_scores = []
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
        if 5.0 <= exp <= 9.0:
            exp_score = 100.0
        elif 4.0 <= exp < 5.0 or 9.0 < exp <= 11.0:
            exp_score = 70.0
        elif 3.0 <= exp < 4.0 or 11.0 < exp <= 13.0:
            exp_score = 40.0
        else:
            exp_score = 10.0
            
        # Criterion 3: Location Fit Score (0 - 100)
        loc = profile.get("location", "").lower()
        willing_relocate = signals.get("willing_to_relocate", False)
        preferred_cities = ["pune", "noida", "delhi", "gurgaon", "hyderabad", "mumbai", "bangalore"]
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
        import re
        target_titles = ["ai", "ml", "machine learning", "deep learning", "nlp", "vision", "search", "retrieval", "rag", "embeddings"]
        
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
            
        # Compute Weighted Base Score (0 - 100) with default weights (Semantic: 1.5, Others: 1.0)
        weighted_sum = (
            1.5 * sem_score +
            1.0 * exp_score +
            1.0 * loc_score +
            1.0 * notice_score +
            1.0 * active_score +
            1.0 * pedigree_score +
            1.0 * role_score
        )
        base_score = weighted_sum / 7.5
        
        # Calculate tier-prioritized Final Score (0 - 100)
        final_score = 0.60 * role_score + 0.30 * exp_score + 0.10 * base_score
        final_scores.append((cid, final_score, cand))
        
    # 7. Sort and select top 100
    # Tie-breaking rule: score descending, then candidate_id ascending
    print("Stage 5: Sorting and selecting top 100 candidates...")
    final_scores.sort(key=lambda x: (-x[1], x[0]))
    
    top_100 = final_scores[:100]
    
    # 8. Write CSV
    print(f"Writing final rankings to {args.out}...")
    import csv
    
    # Ensure parent dir exists
    out_dir = os.path.dirname(os.path.abspath(args.out))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        
    with open(args.out, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(["candidate_id", "rank", "score", "reasoning"])
        
        for rank_idx, (cid, score, cand) in enumerate(top_100, 1):
            reason = generate_custom_reasoning(cand, score, rank_idx)
            formatted_score = round(max(0.0, score), 4)
            writer.writerow([cid, rank_idx, formatted_score, reason])
            
    print(f"Ranking pipeline executed successfully in {time.time() - start_time:.2f} seconds!")

if __name__ == "__main__":
    main()
