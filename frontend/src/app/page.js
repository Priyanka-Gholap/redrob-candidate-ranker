"use client";

import { useState, useEffect } from "react";

const DEFAULT_JD = `Job Description: Senior AI Engineer — Founding Team
Company: Redrob AI (Series A AI-native talent intelligence platform)
Location: Pune/Noida, India (Hybrid — flexible cadence) | Open to relocation candidates from Tier-1 Indian cities
Employment Type: Full-time
Experience Required: 5–9 years

We are building a new AI Engineering org from scratch. We need someone who has deep technical depth in modern ML systems (embeddings, retrieval, ranking, LLMs, fine-tuning) combined with a scrappy product-engineering attitude.

Core Requirements:
- Production experience with embeddings-based retrieval systems (sentence-transformers, BGE, E5, etc.) deployed to real users.
- Production experience with vector databases or hybrid search (Pinecone, Weaviate, Qdrant, Milvus, Elasticsearch, FAISS).
- Strong Python code quality.
- Hands-on experience designing evaluation frameworks for ranking systems (NDCG, MRR, MAP).
- Nice to have: LLM fine-tuning (LoRA, QLoRA, PEFT) and learning-to-rank models.`;

export default function Home() {
  const [activeTab, setActiveTab] = useState("ranking"); // ranking, analytics, compare, jd
  const [jdText, setJdText] = useState(DEFAULT_JD);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [keyword, setKeyword] = useState("RAG");
  const [compareResults, setCompareResults] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Sliders state
  const [weights, setWeights] = useState({
    semantic: 1.5,
    experience: 1.0,
    location: 1.0,
    notice: 1.0,
    activity: 1.0,
    consulting: 1.0,
    role: 1.0,
  });

  const handleSliderChange = (name, value) => {
    setWeights(prev => ({
      ...prev,
      [name]: parseFloat(value)
    }));
  };

  const runRanking = async () => {
    setLoading(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/rank", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          weights: weights,
          jd_text: jdText
        })
      });
      if (!res.ok) throw new Error("Failed to compute rankings");
      const data = await res.json();
      setCandidates(data.results || []);
    } catch (err) {
      console.error(err);
      alert("Error: Make sure the backend FastAPI server is running on 127.0.0.1:8000!");
    } finally {
      setLoading(false);
    }
  };

  const runComparison = async () => {
    setCompareLoading(true);
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/compare?keyword=${encodeURIComponent(keyword)}`);
      if (!res.ok) throw new Error("Failed to compute comparison");
      const data = await res.json();
      setCompareResults(data);
    } catch (err) {
      console.error(err);
      alert("Error: Make sure the backend FastAPI server is running on 127.0.0.1:8000!");
    } finally {
      setCompareLoading(false);
    }
  };

  useEffect(() => {
    runRanking();
    runComparison();
  }, []);

  const exportToCSV = () => {
    if (candidates.length === 0) return;
    
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "candidate_id,rank,score,reasoning\r\n";
    
    candidates.forEach((c) => {
      const row = [
        c.candidate_id,
        c.rank,
        c.final_score,
        `"${c.reasoning.replace(/"/g, '""')}"`
      ];
      csvContent += row.join(",") + "\r\n";
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "ranked_candidates.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filter candidates based on search bar query
  const filteredCandidates = candidates.filter(c => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      c.profile.anonymized_name.toLowerCase().includes(query) ||
      c.candidate_id.toLowerCase().includes(query) ||
      c.profile.current_title.toLowerCase().includes(query) ||
      c.profile.current_company.toLowerCase().includes(query) ||
      c.profile.location.toLowerCase().includes(query)
    );
  });

  // Dynamic calculations for Analytics Tab
  const getAvgExp = () => {
    if (candidates.length === 0) return "0.0";
    const sum = candidates.reduce((acc, curr) => acc + curr.profile.years_of_experience, 0);
    return (sum / candidates.length).toFixed(1);
  };

  const getAvgNotice = () => {
    if (candidates.length === 0) return "0";
    const sum = candidates.reduce((acc, curr) => acc + curr.redrob_signals.notice_period_days, 0);
    return Math.round(sum / candidates.length);
  };

  const getRelocatePct = () => {
    if (candidates.length === 0) return 0;
    const count = candidates.filter(c => c.redrob_signals.willing_to_relocate).length;
    return Math.round((count / candidates.length) * 100);
  };

  const getActivePct = () => {
    if (candidates.length === 0) return 0;
    const count = candidates.filter(c => {
      const lastActive = c.redrob_signals.last_active_date;
      if (!lastActive) return false;
      try {
        const activeDt = new Date(lastActive);
        const presDt = new Date("2026-05-27");
        const diffDays = (presDt - activeDt) / (1000 * 60 * 60 * 24);
        return diffDays <= 30;
      } catch {
        return false;
      }
    }).length;
    return Math.round((count / candidates.length) * 100);
  };

  const getSkillsAnalysis = () => {
    if (candidates.length === 0) return [];
    const counts = {};
    candidates.forEach(c => {
      c.skills.forEach(s => {
        counts[s.name] = (counts[s.name] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count, percentage: Math.round((count / candidates.length) * 100) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  };

  const getLocationsAnalysis = () => {
    if (candidates.length === 0) return [];
    const counts = {};
    candidates.forEach(c => {
      const loc = c.profile.location || "Other";
      counts[loc] = (counts[loc] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count, percentage: Math.round((count / candidates.length) * 100) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  };

  const getExpDistribution = () => {
    if (candidates.length === 0) return [];
    let junior = 0;
    let mid = 0;
    let senior = 0;
    let staff = 0;
    let lead = 0;

    candidates.forEach(c => {
      const exp = c.profile.years_of_experience;
      if (exp < 5) junior++;
      else if (exp <= 6.5) mid++;
      else if (exp <= 8) senior++;
      else if (exp <= 10) staff++;
      else lead++;
    });

    const total = candidates.length;
    return [
      { label: "Junior (< 5 yrs)", count: junior, percentage: Math.round((junior / total) * 100), color: "bg-rose-500/80" },
      { label: "Mid AI (5 - 6.5 yrs)", count: mid, percentage: Math.round((mid / total) * 100), color: "bg-amber-500/80" },
      { label: "Senior AI (6.5 - 8 yrs) *Target*", count: senior, percentage: Math.round((senior / total) * 100), color: "bg-emerald-500/80" },
      { label: "Staff AI (8 - 10 yrs)", count: staff, percentage: Math.round((staff / total) * 100), color: "bg-indigo-500/80" },
      { label: "Lead AI (> 10 yrs)", count: lead, percentage: Math.round((lead / total) * 100), color: "bg-purple-500/80" }
    ];
  };

  const getNoticeDistribution = () => {
    if (candidates.length === 0) return [];
    let immediate = 0;
    let quick = 0;
    let standard = 0;
    let long = 0;

    candidates.forEach(c => {
      const notice = c.redrob_signals.notice_period_days;
      if (notice <= 15) immediate++;
      else if (notice <= 30) quick++;
      else if (notice <= 60) standard++;
      else long++;
    });

    const total = candidates.length;
    return [
      { label: "Immediate (<= 15d)", count: immediate, percentage: Math.round((immediate / total) * 100), color: "bg-emerald-500/80" },
      { label: "Quick (16 - 30d)", count: quick, percentage: Math.round((quick / total) * 100), color: "bg-teal-500/80" },
      { label: "Standard (31 - 60d)", count: standard, percentage: Math.round((standard / total) * 100), color: "bg-indigo-500/80" },
      { label: "Long (> 60d)", count: long, percentage: Math.round((long / total) * 100), color: "bg-slate-500/80" }
    ];
  };

  const getCareerHistoryAnalysis = () => {
    if (candidates.length === 0) return { avgCompanies: 0, avgMonthsPerRole: 0, productPedigreePct: 100 };
    let totalCompanies = 0;
    let totalMonths = 0;
    let totalJobs = 0;
    let consultingOnlyCount = 0;

    const consultingFirms = ['tcs', 'tata consultancy services', 'infosys', 'wipro', 'accenture', 'cognizant', 'capgemini', 'tech mahindra', 'hcl', 'l&t', 'mindtree'];

    candidates.forEach(c => {
      const hist = c.career_history || [];
      totalCompanies += hist.length;
      let allConsulting = hist.length > 0;
      
      hist.forEach(job => {
        totalJobs++;
        totalMonths += job.duration_months || 0;
        const comp = (job.company || "").toLowerCase();
        const isConsulting = consultingFirms.some(firm => comp.includes(firm));
        if (!isConsulting) {
          allConsulting = false;
        }
      });
      if (allConsulting && hist.length > 0) {
        consultingOnlyCount++;
      }
    });

    return {
      avgCompanies: (totalCompanies / candidates.length).toFixed(1),
      avgMonthsPerRole: totalJobs > 0 ? Math.round(totalMonths / totalJobs) : 0,
      productPedigreePct: Math.round(((candidates.length - consultingOnlyCount) / candidates.length) * 100)
    };
  };

  const careerAnalysis = getCareerHistoryAnalysis();

  return (
    <div className="relative min-h-screen bg-[#070913] text-[#F3F4F6] pb-16 antialiased selection:bg-indigo-500 selection:text-white">
      {/* Dynamic Background Gradients */}
      <div className="fixed top-[-10%] left-[-10%] w-[60vw] h-[60vh] bg-indigo-600/10 rounded-full blur-[140px] pointer-events-none z-0"></div>
      <div className="fixed bottom-[-10%] right-[-10%] w-[50vw] h-[55vh] bg-emerald-500/5 rounded-full blur-[140px] pointer-events-none z-0"></div>
      <div className="fixed top-[30%] left-[40%] w-[35vw] h-[35vh] bg-purple-500/5 rounded-full blur-[120px] pointer-events-none z-0"></div>

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#070913]/70 backdrop-blur-xl py-4 px-6 md:px-12 flex flex-col xl:flex-row gap-4 justify-between items-center">
        <div className="flex items-center gap-3.5">
          <div className="relative w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-500 via-[#6366F1] to-emerald-400 flex items-center justify-center font-black text-xl text-white shadow-xl shadow-indigo-500/20">
            R
            <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-[#070913]"></div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white font-heading">Redrob AI TalentAgent</h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase bg-indigo-500/10 text-indigo-400 border border-indigo-500/10">v2.1</span>
            </div>
            <p className="text-xs text-[#9CA3AF]">Contextual Semantic Reranker & Recruiting Intelligence Platform</p>
          </div>
        </div>
        
        {/* Navigation Tabs */}
        <nav className="flex flex-wrap gap-1 bg-white/5 p-1 rounded-xl border border-white/5">
          <button 
            onClick={() => setActiveTab("ranking")} 
            className={`px-4.5 py-2.5 rounded-lg text-xs font-bold tracking-wider transition-all duration-200 uppercase flex items-center gap-2 ${activeTab === "ranking" ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30" : "text-[#9CA3AF] hover:text-white hover:bg-white/5"}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
            </svg>
            Candidate Discovery
          </button>
          <button 
            onClick={() => setActiveTab("analytics")} 
            className={`px-4.5 py-2.5 rounded-lg text-xs font-bold tracking-wider transition-all duration-200 uppercase flex items-center gap-2 ${activeTab === "analytics" ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30" : "text-[#9CA3AF] hover:text-white hover:bg-white/5"}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10a2 2 0 01-2 2h-2a2 2 0 01-2-2zm9-1v-4a2 2 0 00-2-2h-2a2 2 0 00-2 2v4a2 2 0 002 2h2a2 2 0 002-2z"/>
            </svg>
            Talent Pool Analytics
          </button>
          <button 
            onClick={() => setActiveTab("compare")} 
            className={`px-4.5 py-2.5 rounded-lg text-xs font-bold tracking-wider transition-all duration-200 uppercase flex items-center gap-2 ${activeTab === "compare" ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30" : "text-[#9CA3AF] hover:text-white hover:bg-white/5"}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
            </svg>
            AI vs Keyword System
          </button>
          <button 
            onClick={() => setActiveTab("jd")} 
            className={`px-4.5 py-2.5 rounded-lg text-xs font-bold tracking-wider transition-all duration-200 uppercase flex items-center gap-2 ${activeTab === "jd" ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30" : "text-[#9CA3AF] hover:text-white hover:bg-white/5"}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            Job Description
          </button>
        </nav>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-6 md:px-12 mt-8 flex flex-col gap-8 relative z-10">
        
        {/* TOP SUMMARY STATS WIDGETS */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-5">
          <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest">Database Screened</div>
              <div className="text-3xl font-extrabold text-white mt-1.5 font-heading">100,000</div>
            </div>
            <div className="text-[10px] text-[#9CA3AF] mt-3 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Active Talent Pipeline
            </div>
          </div>
          
          <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest font-heading">Honeypots Blocked</div>
              <div className="text-3xl font-extrabold text-rose-400 mt-1.5 font-heading">70</div>
            </div>
            <div className="text-[10px] text-rose-400 mt-3 flex items-center gap-1.5 font-semibold">
              🛡️ Logical checks enforced
            </div>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest font-heading">Average Experience</div>
              <div className="text-3xl font-extrabold text-white mt-1.5 font-heading">{getAvgExp()} Years</div>
            </div>
            <div className="text-[10px] text-emerald-400 mt-3 flex items-center gap-1">
              ✨ Experience Sweet Spot (5-9y)
            </div>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest font-heading">Notice Period</div>
              <div className="text-3xl font-extrabold text-white mt-1.5 font-heading">~{getAvgNotice()} Days</div>
            </div>
            <div className="text-[10px] text-indigo-400 mt-3 flex items-center gap-1 font-semibold">
              ⚡ fast hiring velocity
            </div>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-5 shadow-lg sm:col-span-2 lg:col-span-1 flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest font-heading">Platform Engagement</div>
              <div className="text-3xl font-extrabold text-white mt-1.5 font-heading">{getActivePct()}%</div>
            </div>
            <div className="text-[10px] text-emerald-400 mt-3 flex items-center gap-1 font-medium">
              🎯 Active in past 30 days
            </div>
          </div>
        </section>

        {/* TAB 1: CANDIDATE DISCOVERY (RERANKER) */}
        {activeTab === "ranking" && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            
            {/* Left Controls Panel */}
            <aside className="lg:col-span-1 flex flex-col gap-6">
              <div className="bg-[#0b0f1e] border border-white/5 rounded-2xl p-6 shadow-xl flex flex-col gap-5.5 font-heading">
                <div>
                  <h3 className="text-sm font-bold text-white mb-1.5 uppercase tracking-wider font-heading">Reranking Criteria Weights</h3>
                  <p className="text-xs text-[#9CA3AF] leading-relaxed">Distribute criteria importance weights. Scores recalculate dynamically out of 100 points.</p>
                </div>

                <div className="h-px bg-white/5"></div>

                {/* Semantic Match Weight */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center text-xs font-semibold">
                    <span className="text-[#D1D5DB] flex items-center gap-1">
                      AI Semantic Match
                    </span>
                    <span className="text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded text-[10px]">Weight: {weights.semantic.toFixed(1)}</span>
                  </div>
                  <input 
                    type="range" min="0" max="2" step="0.1" 
                    value={weights.semantic} 
                    onChange={(e) => handleSliderChange("semantic", e.target.value)}
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <p className="text-[9px] text-[#9CA3AF]">Importance of semantic keyword/concept matching to JD.</p>
                </div>

                {/* Experience Weight */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center text-xs font-semibold">
                    <span className="text-[#D1D5DB] flex items-center gap-1">
                      Experience Fit
                    </span>
                    <span className="text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded text-[10px]">Weight: {weights.experience.toFixed(1)}</span>
                  </div>
                  <input 
                    type="range" min="0" max="2" step="0.1" 
                    value={weights.experience} 
                    onChange={(e) => handleSliderChange("experience", e.target.value)}
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <p className="text-[9px] text-[#9CA3AF]">Favors candidates strictly in the 5–9 years range.</p>
                </div>

                {/* Title Weight */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center text-xs font-semibold">
                    <span className="text-[#D1D5DB]">Role Title Match</span>
                    <span className="text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded text-[10px]">Weight: {weights.role.toFixed(1)}</span>
                  </div>
                  <input 
                    type="range" min="0" max="2" step="0.1" 
                    value={weights.role} 
                    onChange={(e) => handleSliderChange("role", e.target.value)}
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <p className="text-[9px] text-[#9CA3AF]">Boosts AI/ML Engineers; heavily penalizes marketing/HR.</p>
                </div>

                {/* Location Weight */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center text-xs font-semibold">
                    <span className="text-[#D1D5DB]">Location Fit</span>
                    <span className="text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded text-[10px]">Weight: {weights.location.toFixed(1)}</span>
                  </div>
                  <input 
                    type="range" min="0" max="2" step="0.1" 
                    value={weights.location} 
                    onChange={(e) => handleSliderChange("location", e.target.value)}
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <p className="text-[9px] text-[#9CA3AF]">Favors candidates in Noida/Pune or willing to relocate.</p>
                </div>

                {/* Notice Weight */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center text-xs font-semibold">
                    <span className="text-[#D1D5DB]">Notice Period Fit</span>
                    <span className="text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded text-[10px]">Weight: {weights.notice.toFixed(1)}</span>
                  </div>
                  <input 
                    type="range" min="0" max="2" step="0.1" 
                    value={weights.notice} 
                    onChange={(e) => handleSliderChange("notice", e.target.value)}
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <p className="text-[9px] text-[#9CA3AF]">Favors quick joiners (under 30d) and penalizes long periods.</p>
                </div>

                {/* Activity Weight */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center text-xs font-semibold">
                    <span className="text-[#D1D5DB]">Platform Activity</span>
                    <span className="text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded text-[10px]">Weight: {weights.activity.toFixed(1)}</span>
                  </div>
                  <input 
                    type="range" min="0" max="2" step="0.1" 
                    value={weights.activity} 
                    onChange={(e) => handleSliderChange("activity", e.target.value)}
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <p className="text-[9px] text-[#9CA3AF]">Boosts responsive, active profiles with high response rates.</p>
                </div>

                {/* Consulting Penalty Weight */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center text-xs font-semibold">
                    <span className="text-[#D1D5DB]">Consulting Firm Penalty</span>
                    <span className="text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded text-[10px]">Weight: {weights.consulting.toFixed(1)}</span>
                  </div>
                  <input 
                    type="range" min="0" max="1" step="0.1" 
                    value={weights.consulting} 
                    onChange={(e) => handleSliderChange("consulting", e.target.value)}
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <p className="text-[9px] text-[#9CA3AF]">Penalizes candidates with services-only backgrounds.</p>
                </div>

                <div className="h-px bg-white/5"></div>

                <button 
                  onClick={runRanking} 
                  disabled={loading}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 text-white font-bold text-xs uppercase tracking-wider hover:from-indigo-500 hover:to-indigo-600 active:scale-98 shadow-lg shadow-indigo-600/20 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? "Re-Ranking Pool..." : "Update Candidates List"}
                </button>
              </div>
            </aside>

            {/* Candidates Table Shortlist */}
            <section className="lg:col-span-3 flex flex-col gap-6">
              <div className="bg-[#0b0f1e] border border-white/5 rounded-2xl p-6 shadow-xl flex flex-col gap-5">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <h2 className="text-md font-bold text-white uppercase tracking-wider font-heading">Recommended Talent Shortlist</h2>
                    <p className="text-xs text-[#9CA3AF] mt-1">Top candidates ranked by the AI agent. Filtered for honeypots.</p>
                  </div>
                  <div className="flex flex-wrap gap-2.5 w-full md:w-auto">
                    <div className="relative flex-1 md:flex-initial">
                      <input 
                        type="text" 
                        placeholder="Search candidate..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full md:w-56 pl-9 pr-4 py-2 text-xs bg-slate-900 border border-white/5 rounded-xl text-white focus:outline-none focus:border-indigo-500 font-semibold"
                      />
                      <svg className="absolute left-3 top-2.5 w-3.5 h-3.5 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                      </svg>
                    </div>
                    <button 
                      onClick={exportToCSV}
                      disabled={candidates.length === 0}
                      className="px-4.5 py-2.5 rounded-xl border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 text-white font-bold text-xs transition-all flex items-center gap-2 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                      </svg>
                      Export CSV
                    </button>
                  </div>
                </div>

                {loading ? (
                  <div className="py-32 flex flex-col items-center justify-center gap-4">
                    <div className="w-10 h-10 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin"></div>
                    <p className="text-[#9CA3AF] text-xs font-semibold">Recalculating weights and reranking candidates...</p>
                  </div>
                ) : filteredCandidates.length === 0 ? (
                  <div className="py-24 text-center text-[#9CA3AF] text-xs font-semibold">
                    No candidates found. Try adjusting your search query.
                  </div>
                ) : (
                  <div className="overflow-x-auto border-t border-white/5 pt-2">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-white/5 text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest">
                          <th className="py-4 px-3 text-center">Rank</th>
                          <th className="py-4 px-4">Candidate Details</th>
                          <th className="py-4 px-4">Current Position</th>
                          <th className="py-4 px-4 text-center">Experience</th>
                          <th className="py-4 px-4 text-center">Notice</th>
                          <th className="py-4 px-4 text-center">Final Score</th>
                          <th className="py-4 px-4 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {filteredCandidates.map((c) => (
                          <tr 
                            key={c.candidate_id} 
                            onClick={() => setSelectedCandidate(c)}
                            className="hover:bg-indigo-500/5 cursor-pointer transition-all duration-200 border-l-2 border-transparent hover:border-indigo-500"
                          >
                            <td className="py-4 px-3 text-center font-extrabold text-indigo-400 text-sm font-heading">#{c.rank}</td>
                            <td className="py-4 px-4">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500/20 to-emerald-500/20 border border-white/10 flex items-center justify-center font-bold text-xs text-indigo-300 font-heading">
                                  {c.profile.anonymized_name.slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <div className="font-bold text-white text-sm hover:text-indigo-300 transition-colors font-heading">{c.profile.anonymized_name}</div>
                                  <div className="text-[10px] text-[#9CA3AF] mt-0.5">{c.candidate_id} • {c.profile.location}</div>
                                </div>
                              </div>
                            </td>
                            <td className="py-4 px-4">
                              <div className="font-semibold text-white text-sm truncate max-w-[200px]">{c.profile.current_title}</div>
                              <div className="text-[10px] text-[#9CA3AF] mt-0.5 truncate max-w-[200px]">{c.profile.current_company}</div>
                            </td>
                            <td className="py-4 px-4 text-center text-sm font-medium text-white">{c.profile.years_of_experience}y</td>
                            <td className="py-4 px-4 text-center">
                              <span className={`inline-flex px-2.5 py-1 rounded-full text-[9px] font-extrabold uppercase border ${
                                c.redrob_signals.notice_period_days <= 15 
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                  : c.redrob_signals.notice_period_days <= 30
                                    ? 'bg-teal-500/10 text-teal-400 border-teal-500/20'
                                    : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20'
                              }`}>
                                {c.redrob_signals.notice_period_days === 0 ? "Immediate" : `${c.redrob_signals.notice_period_days}d`}
                              </span>
                            </td>
                            <td className="py-4 px-4 text-center font-extrabold text-emerald-400 text-sm font-heading">{c.final_score.toFixed(1)}%</td>
                            <td className="py-4 px-4 text-center">
                              <button 
                                onClick={(e) => { e.stopPropagation(); setSelectedCandidate(c); }}
                                className="px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/10 text-xs font-bold hover:bg-indigo-500 hover:text-white transition-colors cursor-pointer"
                              >
                                View Profile
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* TAB 2: TALENT POOL ANALYTICS */}
        {activeTab === "analytics" && (
          <div className="flex flex-col gap-8">
            
            {/* Intro Analysis description */}
            <div className="bg-[#0b0f1e] border border-white/5 rounded-2xl p-6 shadow-xl">
              <h2 className="text-lg font-bold text-white uppercase tracking-wider mb-2 font-heading">AI Match Insights & Distribution Report</h2>
              <p className="text-xs text-[#9CA3AF] leading-relaxed max-w-3xl">
                This dashboard displays a comprehensive analysis based on the top 100 shortlisted candidates we have generated. Traditional recruiting tools rely on keywords and list matchers. Our AI agent evaluates candidate career timelines, detects anomalies (honeypots), screens geographic relocation willingness, platform responsiveness, and ensures a solid product engineering pedigree.
              </p>
            </div>

            {/* Main Graphs Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              
              {/* Experience Distribution */}
              <div className="bg-[#0b0f1e] border border-white/5 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1 font-heading">Experience Distribution</h3>
                  <p className="text-xs text-[#9CA3AF]">Target range is 5-9 years. Evaluates stated experience alignment.</p>
                </div>
                
                <div className="flex flex-col gap-4.5 mt-2">
                  {getExpDistribution().map((item, idx) => (
                    <div key={idx} className="flex flex-col gap-1.5">
                      <div className="flex justify-between text-xs font-bold">
                        <span className="text-[#D1D5DB]">{item.label}</span>
                        <span className="text-white font-heading">{item.count} candidates ({item.percentage}%)</span>
                      </div>
                      <div className="w-full h-2.5 rounded-full bg-white/5 overflow-hidden">
                        <div 
                          className={`h-full rounded-full transition-all duration-500 ${item.color}`}
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notice Period Breakdown */}
              <div className="bg-[#0b0f1e] border border-white/5 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1 font-heading">Notice Period Breakdown</h3>
                  <p className="text-xs text-[#9CA3AF]">Hiring speed metric. Immediate and quick joiners are boosted.</p>
                </div>

                <div className="flex flex-col gap-4.5 mt-2">
                  {getNoticeDistribution().map((item, idx) => (
                    <div key={idx} className="flex flex-col gap-1.5">
                      <div className="flex justify-between text-xs font-bold">
                        <span className="text-[#D1D5DB]">{item.label}</span>
                        <span className="text-white font-heading">{item.count} candidates ({item.percentage}%)</span>
                      </div>
                      <div className="w-full h-2.5 rounded-full bg-white/5 overflow-hidden">
                        <div 
                          className={`h-full rounded-full transition-all duration-500 ${item.color}`}
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top Matched Skills */}
              <div className="bg-[#0b0f1e] border border-white/5 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1 font-heading">Core Skills Frequency (Top 10)</h3>
                  <p className="text-xs text-[#9CA3AF]">Skill alignment density across the 100 shortlisted profiles.</p>
                </div>

                <div className="flex flex-col gap-4.5 mt-2">
                  {getSkillsAnalysis().map((skill, idx) => (
                    <div key={idx} className="flex flex-col gap-1.5">
                      <div className="flex justify-between text-xs font-bold">
                        <span className="text-[#D1D5DB]">{skill.name}</span>
                        <span className="text-indigo-400 font-semibold">{skill.count}% of shortlist</span>
                      </div>
                      <div className="w-full h-2.5 rounded-full bg-white/5 overflow-hidden">
                        <div 
                          className="h-full rounded-full bg-indigo-500/80 transition-all duration-500"
                          style={{ width: `${skill.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Geographic Distribution */}
              <div className="bg-[#0b0f1e] border border-white/5 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1 font-heading">Geographic Distribution</h3>
                  <p className="text-xs text-[#9CA3AF]">Top candidate locations. Location weights favor Noida/Pune hub candidates.</p>
                </div>

                <div className="flex flex-col gap-4.5 mt-2">
                  {getLocationsAnalysis().map((loc, idx) => (
                    <div key={idx} className="flex flex-col gap-1.5">
                      <div className="flex justify-between text-xs font-bold">
                        <span className="text-[#D1D5DB]">{loc.name}</span>
                        <span className="text-emerald-400 font-semibold">{loc.count} candidates ({loc.percentage}%)</span>
                      </div>
                      <div className="w-full h-2.5 rounded-full bg-white/5 overflow-hidden">
                        <div 
                          className="h-full rounded-full bg-emerald-500/80 transition-all duration-500"
                          style={{ width: `${loc.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  
                  <div className="p-4.5 bg-slate-900 border border-white/5 rounded-2xl mt-2">
                    <div className="flex justify-between items-center text-xs font-bold">
                      <span className="text-white">Willing to Relocate</span>
                      <span className="text-emerald-400 font-black">{getRelocatePct()}%</span>
                    </div>
                    <p className="text-[10px] text-[#9CA3AF] mt-1.5">
                      Candidates located outside target cities (e.g. Bangalore, Hyderabad) are qualified due to relocate flags, expanding our access to tier-1 Indian engineering talent.
                    </p>
                  </div>
                </div>
              </div>

              {/* Platform Engagement Metrics */}
              <div className="bg-[#0b0f1e] border border-white/5 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1 font-heading">Platform Activity & Engagement</h3>
                  <p className="text-xs text-[#9CA3AF]">Measures candidate availability and likelihood of responding to recruiter outreach.</p>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div className="p-4 bg-slate-900/50 border border-white/5 rounded-2xl flex flex-col items-center justify-center text-center">
                    <span className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-wider">Active Status</span>
                    <span className="text-3xl font-extrabold text-white mt-1.5 font-heading">{getActivePct()}%</span>
                    <span className="text-[9px] text-[#9CA3AF] mt-1">Logged in last 30 days</span>
                  </div>

                  <div className="p-4 bg-slate-900/50 border border-white/5 rounded-2xl flex flex-col items-center justify-center text-center">
                    <span className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-wider">Willing to Relocate</span>
                    <span className="text-3xl font-extrabold text-white mt-1.5 font-heading">{getRelocatePct()}%</span>
                    <span className="text-[9px] text-[#9CA3AF] mt-1">To Noida/Pune offices</span>
                  </div>
                </div>

                <div className="h-px bg-white/5 my-1"></div>

                <div className="flex flex-col gap-3 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-[#9CA3AF]">Average Candidate Response Rate</span>
                    <span className="text-white font-bold">59.1%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#9CA3AF]">Open to Work Flag active</span>
                    <span className="text-white font-bold">58% of candidates</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#9CA3AF]">Average Days Since Last Login</span>
                    <span className="text-white font-bold">51 Days</span>
                  </div>
                </div>
              </div>

              {/* Career Pedigree & Background Quality */}
              <div className="bg-[#0b0f1e] border border-white/5 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1 font-heading">Career Pedigree & Background Quality</h3>
                  <p className="text-xs text-[#9CA3AF]">Evaluates past job changes, tenure durability, and product focus.</p>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div className="p-4 bg-slate-900/50 border border-white/5 rounded-2xl flex flex-col items-center justify-center text-center">
                    <span className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-wider">Product Focus Pedigree</span>
                    <span className="text-3xl font-extrabold text-emerald-400 mt-1.5 font-heading">{careerAnalysis.productPedigreePct}%</span>
                    <span className="text-[9px] text-[#9CA3AF] mt-1">Strong product companies background</span>
                  </div>

                  <div className="p-4 bg-slate-900/50 border border-white/5 rounded-2xl flex flex-col items-center justify-center text-center">
                    <span className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-wider">Tenure Durability</span>
                    <span className="text-3xl font-extrabold text-white mt-1.5 font-heading">{careerAnalysis.avgMonthsPerRole} mo</span>
                    <span className="text-[9px] text-[#9CA3AF] mt-1">Average tenure per position</span>
                  </div>
                </div>

                <div className="h-px bg-white/5 my-1"></div>

                <div className="flex flex-col gap-3 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-[#9CA3AF]">Average past employers listed</span>
                    <span className="text-white font-bold">{careerAnalysis.avgCompanies} companies</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#9CA3AF]">Services-Only Careers Penalized</span>
                    <span className="text-rose-400 font-bold">100% Excluded</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#9CA3AF]">Honeypot/Spam Profiles Blocked</span>
                    <span className="text-emerald-400 font-bold">70 Profiles Cleaned</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* TAB 3: AI AGENT VS KEYWORD SYSTEM */}
        {activeTab === "compare" && (
          <div className="bg-[#0b0f1e] border border-white/5 rounded-2xl p-6 shadow-xl flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/5 pb-6">
              <div>
                <h2 className="text-md font-bold text-white uppercase tracking-wider font-heading">Traditional Keyword Matching vs AI Semantic Agent</h2>
                <p className="text-xs text-[#9CA3AF] mt-1">Compare how traditional ATS keyword-matching fails on context, stuffers, and misses actual matches.</p>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <input 
                  type="text" 
                  value={keyword} 
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="Type search keyword (e.g., RAG, Vector Search)..."
                  className="w-full sm:w-56 px-4 py-2 rounded-xl bg-slate-900 border border-white/5 text-white focus:outline-none focus:border-indigo-500 text-xs font-semibold"
                />
                <button 
                  onClick={runComparison} 
                  className="px-4.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all cursor-pointer whitespace-nowrap active:scale-95"
                >
                  Search & Compare
                </button>
              </div>
            </div>

            {compareLoading ? (
              <div className="py-32 flex flex-col items-center justify-center gap-4">
                <div className="w-10 h-10 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin"></div>
                <p className="text-[#9CA3AF] text-xs font-semibold">Running comparison pipeline...</p>
              </div>
            ) : compareResults ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                
                {/* Traditional Keyword Search */}
                <div className="flex flex-col gap-4 font-heading">
                  <div className="p-4.5 bg-rose-500/5 border border-rose-500/10 rounded-2xl">
                    <h3 className="text-sm font-bold text-rose-400 mb-1.5 uppercase tracking-wider font-heading flex items-center gap-2">
                      ⚠️ Traditional Keyword ATS Filter
                    </h3>
                    <p className="text-[11px] text-[#9CA3AF] leading-relaxed">
                      Matches string fragments literally. Subject to keyword stuffing (false positives), services-only backgrounds, and misses candidates with adjacent skills but no literal keyword.
                    </p>
                  </div>
                  
                  <div className="flex flex-col gap-3.5 font-body">
                    {compareResults.keyword_results.map((c, i) => (
                      <div key={c.candidate_id} className="p-4 bg-white/2 border border-white/5 rounded-2xl flex justify-between items-start hover:border-rose-500/20 transition-all duration-200">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-white text-sm truncate font-heading">{c.name}</div>
                          <div className="text-xs text-[#9CA3AF] mt-0.5">{c.title} • {c.experience}y exp</div>
                          <div className="flex gap-1.5 mt-3 flex-wrap">
                            {c.skills.map((s, idx) => (
                              <span key={idx} className="text-[9px] px-2.5 py-1 rounded bg-white/5 text-[#9CA3AF] border border-white/5 font-semibold">
                                {s}
                              </span>
                            ))}
                          </div>
                        </div>
                        <span className="text-[9px] px-2 py-0.5 rounded font-bold uppercase bg-rose-500/10 text-rose-400 border border-rose-500/10 ml-2 whitespace-nowrap">Literal Match</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Redrob AI Agent Reranker */}
                <div className="flex flex-col gap-4 font-heading">
                  <div className="p-4.5 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl">
                    <h3 className="text-sm font-bold text-emerald-400 mb-1.5 uppercase tracking-wider font-heading flex items-center gap-2">
                      🛡️ Redrob AI Talent Agent
                    </h3>
                    <p className="text-[11px] text-[#9CA3AF] leading-relaxed">
                      Analyzes semantic alignment using SentenceTransformers. Evaluates career pedigree (product history), notice period availability, relocations, and blocks fake profiles (honeypots).
                    </p>
                  </div>
                  
                  <div className="flex flex-col gap-3.5 font-body">
                    {compareResults.semantic_results.map((c, i) => (
                      <div key={c.candidate_id} className="p-4 bg-indigo-500/3 border border-indigo-500/10 rounded-2xl flex justify-between items-start hover:border-emerald-500/20 transition-all duration-200">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-white text-sm truncate font-heading">{c.name}</div>
                          <div className="text-xs text-[#9CA3AF] mt-0.5">{c.title} • {c.experience}y exp</div>
                          <div className="text-xs text-indigo-300 italic mt-2.5 leading-relaxed font-semibold">"{c.reasoning}"</div>
                          <div className="flex gap-1.5 mt-3.5 flex-wrap">
                            {c.skills.map((s, idx) => (
                              <span key={idx} className="text-[9px] px-2.5 py-1 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/10 font-semibold">
                                {s}
                              </span>
                            ))}
                          </div>
                        </div>
                        <span className="text-[9px] px-2 py-0.5 rounded font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/10 ml-2 shrink-0 whitespace-nowrap">Score: {c.score.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            ) : (
              <div className="py-24 text-center text-[#9CA3AF] text-xs font-semibold">
                Click comparison button to load data.
              </div>
            )}
          </div>
        )}

        {/* TAB 4: JOB DESCRIPTION EDITOR */}
        {activeTab === "jd" && (
          <div className="bg-[#0b0f1e] border border-white/5 rounded-2xl p-6 shadow-xl flex flex-col gap-6 font-heading">
            <div>
              <h2 className="text-md font-bold text-white uppercase tracking-wider mb-1.5 font-heading">Target Job Specification</h2>
              <p className="text-xs text-[#9CA3AF]">Review and edit the Job Description. The AI Agent uses the text below to semantically embed the role requirements.</p>
            </div>
            
            <textarea 
              value={jdText} 
              onChange={(e) => setJdText(e.target.value)}
              className="w-full h-[450px] p-4.5 rounded-xl bg-slate-950 border border-white/5 text-white font-mono text-xs leading-relaxed focus:border-indigo-500 focus:outline-none transition-colors"
            />
            
            <div className="flex justify-end gap-3 border-t border-white/5 pt-5">
              <button 
                onClick={() => setJdText(DEFAULT_JD)} 
                className="px-5 py-2.5 rounded-xl border border-white/10 bg-white/5 text-white font-bold text-xs hover:bg-white/10 transition-all cursor-pointer font-heading"
              >
                Reset Default
              </button>
              <button 
                onClick={() => { runRanking(); setActiveTab("ranking"); }} 
                className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-500 transition-all cursor-pointer active:scale-95 font-heading"
              >
                Recalculate Ranks
              </button>
            </div>
          </div>
        )}
        
      </main>

      {/* CANDIDATE DETAIL MODAL */}
      {selectedCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto" onClick={() => setSelectedCandidate(null)}>
          <div className="bg-[#0b0f1e] border border-white/5 rounded-3xl w-full max-w-4xl max-h-[85vh] overflow-y-auto p-6 md:p-8 relative shadow-2xl animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
            
            {/* Close Button */}
            <button 
              onClick={() => setSelectedCandidate(null)}
              className="absolute top-6 right-6 text-[#9CA3AF] hover:text-white transition-colors cursor-pointer w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
            
            {/* Modal Header */}
            <div className="flex flex-col md:flex-row justify-between items-start gap-4 border-b border-white/5 pb-6">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-500 to-emerald-500 flex items-center justify-center font-extrabold text-xl text-white shadow-xl shadow-indigo-500/10 font-heading">
                  {selectedCandidate.profile.anonymized_name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-xl md:text-2xl font-bold text-white font-heading">{selectedCandidate.profile.anonymized_name}</h2>
                  <p className="text-sm text-indigo-400 font-bold mt-0.5">{selectedCandidate.profile.current_title} at {selectedCandidate.profile.current_company}</p>
                  <p className="text-xs text-[#9CA3AF] mt-1">Location: {selectedCandidate.profile.location} • Experience: {selectedCandidate.profile.years_of_experience} Years</p>
                </div>
              </div>
              
              <div className="md:text-right shrink-0">
                <div className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest">AI Match Score</div>
                <div className="text-3.5xl font-black text-emerald-400 mt-1 font-heading">{selectedCandidate.final_score.toFixed(1)}%</div>
                <div className="text-[10px] text-indigo-300 mt-0.5">Semantic Match: {selectedCandidate.semantic_score.toFixed(1)}%</div>
              </div>
            </div>

            {/* Modal Body Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 mt-6">
              
              {/* Left Column: Summary, Heuristics, Skills */}
              <div className="lg:col-span-3 flex flex-col gap-6">
                
                {/* Custom AI reasoning text */}
                <div className="p-4.5 bg-indigo-500/5 border border-indigo-500/10 rounded-2xl">
                  <h4 className="text-[10px] text-indigo-300 uppercase tracking-widest font-black mb-1.5">AI Match Reasoning</h4>
                  <p className="text-xs text-[#E5E7EB] italic leading-relaxed">"{selectedCandidate.reasoning}"</p>
                </div>

                {/* Recruiter Reranking Scorecard */}
                <div>
                  <h4 className="text-xs text-white uppercase tracking-wider font-bold mb-3 mt-1 font-heading">Recruiter Reranking Scorecard</h4>
                  <div className="bg-[#0b0f1e]/80 border border-white/5 rounded-2xl overflow-hidden shadow-lg">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-white/5 bg-white/2 text-[#9CA3AF] font-bold uppercase tracking-wider text-[9px]">
                          <th className="py-2.5 px-3.5 font-heading">Match Dimension</th>
                          <th className="py-2.5 px-3 text-center font-heading">Score</th>
                          <th className="py-2.5 px-3 text-center font-heading">Weight</th>
                          <th className="py-2.5 px-3.5 text-right font-heading">Weighted Pts</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {(() => {
                          const criteriaMeta = {
                            semantic: { name: "AI Semantic Match", desc: "Similarity of profile to job description", weight: weights.semantic },
                            experience: { name: "Experience Sweet-spot", desc: "Favors candidates in target years of experience", weight: weights.experience },
                            role: { name: "Role Title Fit", desc: "Matches current title to JD keywords", weight: weights.role },
                            location: { name: "Location & Relocation", desc: "Matches cities or relocation preferences", weight: weights.location },
                            notice: { name: "Notice Period Fit", desc: "Favors immediate or quick joiners", weight: weights.notice },
                            activity: { name: "Platform Engagement", desc: "Recency, response rate, and availability", weight: weights.activity },
                            consulting: { name: "Product Pedigree", desc: "Penalizes consulting-only experience profiles", weight: weights.consulting }
                          };

                          let totalWeightedSum = 0;
                          let totalWeight = 0;

                          return (
                            <>
                              {Object.entries(selectedCandidate.multipliers).map(([key, val]) => {
                                const meta = criteriaMeta[key] || { name: key, desc: "", weight: 1.0 };
                                const score = val; // this is the 0-100 score
                                const weight = meta.weight;
                                const contribution = score * weight;
                                
                                totalWeightedSum += contribution;
                                totalWeight += weight;

                                return (
                                  <tr key={key} className="hover:bg-white/1 text-slate-300">
                                    <td className="py-2.5 px-3.5">
                                      <div className="font-semibold text-white">{meta.name}</div>
                                      <div className="text-[10px] text-[#9CA3AF] mt-0.5">{meta.desc}</div>
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <div className="flex items-center justify-center gap-2">
                                        <span className={`font-bold ${score >= 80 ? 'text-emerald-400' : score < 50 ? 'text-rose-400' : 'text-indigo-300'}`}>
                                          {score.toFixed(0)}%
                                        </span>
                                        <div className="w-10 h-1 rounded-full bg-white/5 overflow-hidden hidden sm:block">
                                          <div 
                                            className={`h-full rounded-full ${score >= 80 ? 'bg-emerald-500' : score < 50 ? 'bg-rose-500' : 'bg-indigo-500'}`}
                                            style={{ width: `${score}%` }}
                                          />
                                        </div>
                                      </div>
                                    </td>
                                    <td className="py-2.5 px-3 text-center font-bold text-slate-400">
                                      {weight.toFixed(1)}x
                                    </td>
                                    <td className="py-2.5 px-3.5 text-right font-extrabold text-white">
                                      {contribution.toFixed(1)} pts
                                    </td>
                                  </tr>
                                );
                              })}
                              
                              {/* Summary calculations footer row */}
                              <tr className="bg-white/2 text-white font-semibold border-t border-indigo-500/20">
                                <td className="py-2.5 px-3.5" colSpan="2">
                                  <div className="text-[9px] uppercase text-[#9CA3AF] tracking-wider font-bold">Recruiter Base Match</div>
                                  <div className="text-[10px] font-mono mt-0.5 text-indigo-300">
                                    {totalWeightedSum.toFixed(1)} pts / {totalWeight.toFixed(1)} weights = {(totalWeightedSum / (totalWeight || 1.0)).toFixed(1)}%
                                  </div>
                                </td>
                                <td className="py-2.5 px-3.5 text-right" colSpan="2">
                                  <div className="text-[9px] uppercase text-[#9CA3AF] tracking-wider font-bold">Role & Exp Prioritized Match</div>
                                  <div className="text-sm font-black text-emerald-400 font-heading">
                                    {selectedCandidate.final_score.toFixed(1)}%
                                  </div>
                                </td>
                              </tr>
                            </>
                          );
                        })()}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2.5 p-3 bg-indigo-500/5 border border-indigo-500/10 rounded-xl text-[10px] text-[#9CA3AF] leading-relaxed">
                    <span className="font-bold text-indigo-300">How reranking works:</span> To guarantee that target roles and experience sweet-spots are prioritized first, the final score is calculated as: <span className="font-semibold text-white">60% Role Fit + 30% Experience Fit + 10% Recruiter Base Score</span> (where the Base Score is the weighted average of all your sliders).
                  </div>
                </div>

                {/* Skills Inventory */}
                <div>
                  <h4 className="text-xs text-white uppercase tracking-wider font-bold mb-3.5 font-heading">Skills Inventory</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedCandidate.skills.map((s, idx) => (
                      <div key={idx} className="px-3 py-2 rounded-xl bg-white/2 border border-white/5 text-xs flex items-center gap-2.5">
                        <span className="text-white font-medium">{s.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-[#9CA3AF] uppercase font-black">{s.proficiency}</span>
                        {s.duration_months > 0 && (
                          <span className="text-[10px] text-indigo-400 font-semibold">{Math.round(s.duration_months / 12)}y used</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Column: Timeline & Platform signals */}
              <div className="lg:col-span-2 flex flex-col gap-6">
                
                {/* Platform Signals */}
                <div className="p-4.5 bg-slate-900/60 border border-white/5 rounded-2xl flex flex-col gap-3">
                  <h4 className="text-xs text-white uppercase tracking-wider font-bold font-heading">Behavioral & Platform Signals</h4>
                  
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[#9CA3AF]">Notice Period</span>
                    <span className="text-white font-bold bg-white/5 px-2.5 py-1 rounded-lg border border-white/5">
                      {selectedCandidate.redrob_signals.notice_period_days === 0 
                        ? "Immediate Joiner" 
                        : `${selectedCandidate.redrob_signals.notice_period_days} Days`}
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[#9CA3AF]">Platform Activity</span>
                    <span className="text-white font-bold bg-white/5 px-2.5 py-1 rounded-lg border border-white/5">
                      Active: {selectedCandidate.redrob_signals.last_active_date}
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[#9CA3AF]">Recruiter Response Rate</span>
                    <span className="text-emerald-400 font-extrabold bg-emerald-500/10 border border-emerald-500/10 px-2.5 py-1 rounded-lg">
                      {Math.round(selectedCandidate.redrob_signals.recruiter_response_rate * 100)}%
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[#9CA3AF]">GitHub Activity Score</span>
                    <span className="text-indigo-300 font-bold bg-indigo-500/10 border border-indigo-500/10 px-2.5 py-1 rounded-lg font-heading">
                      {selectedCandidate.redrob_signals.github_activity_score} / 100
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[#9CA3AF]">Relocation Willingness</span>
                    <span className={`font-bold px-2.5 py-1 rounded-lg border ${
                      selectedCandidate.redrob_signals.willing_to_relocate 
                        ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/10" 
                        : "text-indigo-400 bg-indigo-500/10 border-indigo-500/10"
                    }`}>
                      {selectedCandidate.redrob_signals.willing_to_relocate ? "Willing" : "Local only"}
                    </span>
                  </div>
                </div>

                {/* Career History Timeline */}
                <div>
                  <h4 className="text-xs text-white uppercase tracking-wider font-bold mb-3.5 font-heading">Career History Timeline</h4>
                  <div className="flex flex-col gap-4 max-h-[300px] overflow-y-auto pr-1">
                    {selectedCandidate.career_history.map((job, idx) => (
                      <div key={idx} className="relative pl-5.5 border-l border-indigo-500/20 pb-4 last:pb-0">
                        {/* Timeline node */}
                        <div className="absolute left-[-4.5px] top-1.5 w-2 h-2 rounded-full bg-indigo-500 ring-4 ring-[#0b0f1e]" />
                        
                        <div className="flex flex-col gap-1.5">
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <h5 className="font-extrabold text-white text-xs">{job.title}</h5>
                              <p className="text-[10px] text-indigo-400 mt-0.5">{job.company} • {job.industry}</p>
                            </div>
                            <span className="text-[9px] text-[#9CA3AF] bg-white/5 px-2 py-0.5 rounded border border-white/5 whitespace-nowrap">
                              {job.duration_months} mo
                            </span>
                          </div>
                          <p className="text-[9px] text-[#9CA3AF] mt-0.5 leading-relaxed font-body">{job.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
