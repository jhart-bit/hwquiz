import React, { useState, useEffect, useRef } from 'react';
import { 
  UploadCloud, BookOpen, CheckSquare, Settings, 
  Users, CheckCircle, Download, FileText, AlertCircle,
  Loader2, Calculator, Play, ChevronRight, GraduationCap,
  Sigma, Type, Image as ImageIcon
} from 'lucide-react';

// EXACTLY ONE SET OF FIREBASE IMPORTS
import { initializeApp } from "firebase/app";
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFirestore, collection, doc, setDoc, onSnapshot, addDoc, updateDoc } from "firebase/firestore";

// --- Firebase Setup ---
const firebaseConfig = {
  apiKey: "AIzaSyBuqwjjiu_p-4leYdV0BD7N6rVUZ2se66A",
  authDomain: "hwquiz-ca034.firebaseapp.com",
  projectId: "hwquiz-ca034",
  storageBucket: "hwquiz-ca034.firebasestorage.app",
  messagingSenderId: "857480358154",
  appId: "1:857480358154:web:95c6733df2f5ad8bae72f3",
  measurementId: "G-6EW3SJ1ZK8"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'default-app-id';

// --- API & Utility Functions ---
const apiKey = import.meta.env.VITE_GEMINI_API_KEY; // <--- PASTE YOUR GEMINI KEY HERE

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const fetchWithRetry = async (url, options, retries = 5) => {
  let delay = 1000;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await sleep(delay);
      delay *= 2;
    }
  }
};

const callGemini = async (prompt, schema = null, images = []) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
  
  const parts = [{ text: prompt }];
  images.forEach(img => {
    const base64Data = img.split(',')[1];
    if (base64Data) {
      parts.push({
        inlineData: { mimeType: "image/jpeg", data: base64Data }
      });
    }
  });

  const payload = {
    contents: [{ parts }],
  };

  if (schema) {
    payload.generationConfig = {
      responseMimeType: "application/json",
      responseSchema: schema
    };
  }

  const data = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Invalid response from AI");
  
  return schema ? JSON.parse(text) : text;
};

// --- Parsers & Rendering Components ---
const extractImagesFromPDF = async (file) => {
  if (!window.pdfjsLib) throw new Error("PDF parser not loaded yet.");
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let images = [];
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    images.push(canvas.toDataURL('image/jpeg', 0.8));
  }
  return images;
};

const extractTextFromPDF = async (file) => {
  if (!window.pdfjsLib) throw new Error("PDF parser not loaded yet.");
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(" ") + "\n";
  }
  return text;
};

const cropImage = (dataUrl, box) => {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      const padding = 2;
      let xmin = Math.max(0, box.xmin - padding);
      let xmax = Math.min(100, box.xmax + padding);
      let ymin = Math.max(0, box.ymin - padding);
      let ymax = Math.min(100, box.ymax + padding);

      const x = (xmin / 100) * img.width;
      const y = (ymin / 100) * img.height;
      const w = ((xmax - xmin) / 100) * img.width;
      const h = ((ymax - ymin) / 100) * img.height;
      
      if(w <= 0 || h <= 0) return resolve(null);

      canvas.width = w;
      canvas.height = h;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
};

const parseStudentHtmlToText = (html) => {
  if (!html) return "No answer provided.";
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  const mathFields = doc.querySelectorAll('math-field');
  mathFields.forEach(mf => {
    const latex = mf.getAttribute('value') || '';
    const textNode = doc.createTextNode(` $$${latex}$$ `);
    mf.parentNode.replaceChild(textNode, mf);
  });
  
  return doc.body.textContent || doc.body.innerText || "";
};

const MathText = ({ text, className }) => {
  const containerRef = useRef(null);
  
  useEffect(() => {
    let isCancelled = false;
    const typeset = async () => {
      if (window.MathJax && window.MathJax.typesetPromise && containerRef.current) {
         try {
           await window.MathJax.typesetPromise([containerRef.current]);
         } catch(e) {}
      }
    };
    
    const interval = setInterval(() => {
       if(window.MathJax?.typesetPromise) {
          clearInterval(interval);
          typeset();
       }
    }, 500);
    
    return () => { isCancelled = true; clearInterval(interval); };
  }, [text]);

  return <div ref={containerRef} className={className} style={{ whiteSpace: 'pre-wrap' }}>{text}</div>;
};

const HybridEditor = ({ value, onChange }) => {
  const editorRef = useRef(null);

  useEffect(() => {
    if (editorRef.current && !editorRef.current.innerHTML && value) {
      editorRef.current.innerHTML = value;
    }
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const handleEditorInput = (e) => {
      if (e.target.tagName && e.target.tagName.toLowerCase() === 'math-field') {
        e.target.setAttribute('value', e.target.value);
      }
      onChange(editor.innerHTML);
    };

    editor.addEventListener('input', handleEditorInput);
    return () => editor.removeEventListener('input', handleEditorInput);
  }, [onChange]);

  const insertMath = () => {
    const mf = document.createElement('math-field');
    mf.setAttribute('style', 'display: inline-block; min-width: 40px; margin: 0 4px; vertical-align: middle; background: #fff; border: 1px solid #94a3b8; border-radius: 4px; padding: 2px 6px;');
    
    const selection = window.getSelection();
    
    if (selection.rangeCount > 0 && editorRef.current.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(mf);
      
      const space = document.createTextNode('\u00A0');
      range.insertNode(space);
      range.setStartAfter(space);
      range.collapse(true);
      
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      editorRef.current.appendChild(mf);
      editorRef.current.appendChild(document.createTextNode('\u00A0'));
    }
    
    setTimeout(() => mf.focus(), 50);
    onChange(editorRef.current.innerHTML);
  };

  return (
    <div className="border border-slate-300 rounded-lg overflow-hidden flex flex-col focus-within:ring-2 focus-within:ring-indigo-500 bg-white transition-all shadow-sm">
      <div className="bg-slate-50 border-b border-slate-200 p-2 flex gap-2 items-center">
        <button 
          onMouseDown={(e) => e.preventDefault()} 
          onClick={insertMath} 
          className="text-xs font-bold flex items-center gap-1.5 bg-white border border-slate-300 px-3 py-1.5 rounded-md hover:bg-slate-100 hover:border-slate-400 transition-colors text-slate-700"
        >
          <Sigma className="w-3.5 h-3.5 text-indigo-600" /> Insert Math
        </button>
        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold ml-2 flex items-center gap-1">
          <Type className="w-3 h-3" /> Type text normally anywhere
        </span>
      </div>
      <div 
        ref={editorRef}
        contentEditable
        className="p-4 min-h-[120px] outline-none text-slate-800 leading-relaxed"
        style={{ cursor: 'text' }}
        placeholder="Type your explanation here. Click 'Insert Math' to add formulas..."
      />
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState('setup');
  const [user, setUser] = useState(null);
  
  const [questionsImages, setQuestionsImages] = useState([]);
  const [answerKeyText, setAnswerKeyText] = useState('');
  const [extractedQuestions, setExtractedQuestions] = useState([]);
  const [selectedQuestions, setSelectedQuestions] = useState([]);
  const [setupPhase, setSetupPhase] = useState(1);
  const [quizConfig, setQuizConfig] = useState(null);

  const [currentResponses, setCurrentResponses] = useState({});
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const [submissions, setSubmissions] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');

  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.error("Auth init failed", err);
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    
    const configRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'main');
    const unsubConfig = onSnapshot(configRef, (docSnap) => {
      if (docSnap.exists()) {
        setQuizConfig(docSnap.data());
        setSetupPhase(4);
      }
    }, (err) => console.error("Config sync error:", err));

    const subsRef = collection(db, 'artifacts', appId, 'public', 'data', 'submissions');
    const unsubSubs = onSnapshot(subsRef, (snap) => {
      const loaded = [];
      snap.forEach(d => loaded.push({ id: d.id, ...d.data() }));
      setSubmissions(loaded);
      
      if (user.email) {
         const mySub = loaded.find(s => s.studentEmail === user.email);
         if (mySub) setHasSubmitted(true);
      }
    }, (err) => console.error("Submissions sync error:", err));

    return () => { unsubConfig(); unsubSubs(); };
  }, [user]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setHasSubmitted(false);
    setCurrentResponses({});
  };

  useEffect(() => {
    const scriptPDF = document.createElement('script');
    scriptPDF.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
    scriptPDF.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    };
    document.body.appendChild(scriptPDF);

    window.MathJax = {
      tex: { inlineMath: [['$', '$'], ['\\(', '\\)']], displayMath: [['$$', '$$'], ['\\[', '\\]']] },
      startup: { typeset: false }
    };
    const scriptMathJax = document.createElement('script');
    scriptMathJax.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';
    scriptMathJax.async = true;
    document.body.appendChild(scriptMathJax);

    const scriptMathLive = document.createElement('script');
    scriptMathLive.type = 'module';
    scriptMathLive.src = 'https://unpkg.com/mathlive?module';
    document.body.appendChild(scriptMathLive);
  }, []);

  const handleFileUpload = async (e, type) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setIsProcessing(true);
    setProcessingStatus(`Processing ${type} PDF...`);
    
    try {
      if (type === 'questions') {
        const images = await extractImagesFromPDF(file);
        setQuestionsImages(images);
      } else {
        const text = await extractTextFromPDF(file);
        setAnswerKeyText(text);
      }
    } catch (err) {
      alert("Failed to process PDF. Ensure it is a valid document.");
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const processQuestionsWithAI = async () => {
    if (questionsImages.length === 0) return;
    setIsProcessing(true);
    setProcessingStatus("AI is analyzing the pages to extract questions and visual figures...");

    try {
      const prompt = `
        You are a helpful assistant for a math teacher. 
        Attached are images of pages from a math assignment.
        Extract all the distinct math problems/questions from these pages.
        Ignore headers, page numbers, and general instructions.
        
        CRITICAL INSTRUCTIONS: 
        1. Format all mathematical equations, variables, and expressions in LaTeX. Use single dollar signs for inline math (e.g., $x^2 + 1$) and double dollar signs for block math (e.g., $$y = mx + b$$).
        2. If a question has sub-parts (e.g., a, b, c), extract them into the 'parts' array. 
        3. If a question has NO sub-parts, create exactly ONE item in the 'parts' array with an empty string "" for the label.
        4. FIGURES/GRAPHS: If a question references a graph, diagram, table, or figure, set hasFigure to true and provide its bounding box using 'figureBox'.
           - pageIndex: The 0-based index of the page (e.g., 0 for the first page).
           - xmin, xmax: The left and right boundaries as a percentage of the page width (0 to 100).
           - ymin, ymax: The top and bottom boundaries as a percentage of the page height (0 to 100).
           - Be generous with the bounding box to ensure the entire figure is captured.
      `;

      const schema = {
        type: "OBJECT",
        properties: {
          questions: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                id: { type: "STRING" },
                text: { type: "STRING" },
                hasFigure: { type: "BOOLEAN" },
                figureBox: {
                  type: "OBJECT",
                  properties: {
                    pageIndex: { type: "INTEGER" },
                    ymin: { type: "INTEGER" },
                    ymax: { type: "INTEGER" },
                    xmin: { type: "INTEGER" },
                    xmax: { type: "INTEGER" }
                  }
                },
                parts: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      id: { type: "STRING" },
                      label: { type: "STRING", description: "e.g., a, b, c, or empty if no parts" },
                      text: { type: "STRING" }
                    }
                  }
                }
              }
            }
          }
        }
      };

      const result = await callGemini(prompt, schema, questionsImages);
      
      const sanitizedQuestions = await Promise.all((result.questions || []).map(async q => {
        let finalQ = { ...q };
        if (!finalQ.parts || finalQ.parts.length === 0) {
           finalQ.parts = [{ id: `${q.id}-p1`, label: '', text: 'Provide your answer below:' }];
        }
        if (finalQ.hasFigure && finalQ.figureBox && questionsImages[finalQ.figureBox.pageIndex]) {
          try {
            finalQ.imageUrl = await cropImage(questionsImages[finalQ.figureBox.pageIndex], finalQ.figureBox);
          } catch (e) {
            console.error("Image cropping failed for", q.id, e);
          }
        }
        return finalQ;
      }));

      setExtractedQuestions(sanitizedQuestions);
      setSetupPhase(2);
    } catch (err) {
      console.error(err);
      alert("Failed to extract questions. Please check your API key and try again.");
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const toggleQuestionSelection = (q) => {
    const exists = selectedQuestions.find(sq => sq.id === q.id);
    if (exists) {
      setSelectedQuestions(selectedQuestions.filter(sq => sq.id !== q.id));
    } else {
      const partsWithConfig = q.parts.map(p => ({
        ...p,
        maxPoints: 5,
        rubric: '1 pt for correct formula.\n3 pts for clear working steps.\n1 pt for the correct final answer.'
      }));
      setSelectedQuestions([...selectedQuestions, { ...q, parts: partsWithConfig }]);
    }
  };

  const updatePartConfig = (questionId, partId, field, value) => {
    setSelectedQuestions(selectedQuestions.map(q => {
      if (q.id === questionId) {
        return {
          ...q,
          parts: q.parts.map(p => p.id === partId ? { ...p, [field]: value } : p)
        };
      }
      return q;
    }));
  };

  const finalizeSetup = async () => {
    const newConfig = {
      questions: selectedQuestions,
      answerKey: answerKeyText
    };
    
    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'config', 'main'), newConfig);
      alert("Quiz configured & saved to cloud successfully! You can now switch to the Student Portal.");
    } catch (err) {
      console.error("Error saving config:", err);
      alert("Failed to save quiz configuration.");
    }
  };

  const handleStudentSubmit = async () => {
    if (!user?.email) {
      alert("Please sign in to submit your assessment.");
      return;
    }

    const newSubmission = {
      studentEmail: user.email,
      studentName: user.displayName || user.email.split('@')[0],
      userId: user.uid,
      responses: { ...currentResponses },
      graded: false,
      results: null,
      timestamp: new Date().toISOString()
    };

    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'submissions'), newSubmission);
      setHasSubmitted(true);
    } catch (err) {
      console.error("Error submitting:", err);
      alert("Failed to submit assessment.");
    }
  };

  const resetStudentPortal = () => {
    setCurrentResponses({});
    setHasSubmitted(false);
  };

  const gradeAllSubmissions = async () => {
    const ungraded = submissions.filter(s => !s.graded);
    if (ungraded.length === 0) return;

    setIsProcessing(true);

    for (let i = 0; i < ungraded.length; i++) {
      let sub = ungraded[i];

      setProcessingStatus(`Grading submission for ${sub.studentName}...`);
      let totalScore = 0;
      let totalMax = 0;
      let itemizedResults = {};

      for (const q of quizConfig.questions) {
        for (const p of q.parts) {
          const studentHtml = sub.responses[p.id] || "";
          const parsedStudentText = parseStudentHtmlToText(studentHtml);
          totalMax += Number(p.maxPoints);

          const contextQuestion = p.label ? `Main Question: ${q.text}\nPart (${p.label}): ${p.text}` : q.text;

          const prompt = `
            You are an expert math teacher grading a quiz.
            
            Question Context: ${contextQuestion}
            Maximum Points for this part: ${p.maxPoints}
            Rubric Breakdown: ${p.rubric}
            
            Teacher's Answer Key Context (Use this to find the correct answer, but compensate using your expertise if the key is brief or incomplete):
            ${quizConfig.answerKey}
            
            Student's Written Explanation & Mathematical Answer:
            "${parsedStudentText}"
            
            Evaluate the student's answer. Award partial credit according to the rubric. 
            Return the score awarded and a brief feedback sentence explaining the deduction (if any).
          `;

          const schema = {
            type: "OBJECT",
            properties: {
              score: { type: "NUMBER" },
              feedback: { type: "STRING" }
            }
          };

          try {
            const result = await callGemini(prompt, schema);
            const finalScore = Math.min(Math.max(0, result.score), Number(p.maxPoints));
            
            itemizedResults[p.id] = {
              score: finalScore,
              feedback: result.feedback
            };
            totalScore += finalScore;
          } catch (err) {
            console.error("Grading failed for part", p.id, err);
            itemizedResults[p.id] = { score: 0, feedback: "Error during automated grading. Requires manual review." };
          }
        }
      }

      try {
        const subRef = doc(db, 'artifacts', appId, 'public', 'data', 'submissions', sub.id);
        await updateDoc(subRef, {
          graded: true,
          results: {
            itemized: itemizedResults,
            totalScore,
            totalMax,
            percentage: ((totalScore / totalMax) * 100).toFixed(1)
          }
        });
      } catch (err) {
        console.error("Failed to update submission in Firestore:", err);
      }
    }

    setIsProcessing(false);
    setProcessingStatus('');
  };

  const exportCSV = () => {
    if (!quizConfig || submissions.length === 0) return;

    const headers = ['Student Name', 'Email'];
    quizConfig.questions.forEach((q, i) => {
      q.parts.forEach(p => {
        const prefix = p.label ? `Q${i+1}${p.label}` : `Q${i+1}`;
        headers.push(`${prefix} Score (Max ${p.maxPoints})`);
        headers.push(`${prefix} Feedback`);
      });
    });
    headers.push('Total Score');
    headers.push('Max Points');
    headers.push('Final Grade (%)');

    let csvContent = headers.join(',') + '\n';

    submissions.forEach(sub => {
      if (!sub.graded) return;
      
      const row = [`"${sub.studentName}"`, `"${sub.studentEmail}"`];
      
      quizConfig.questions.forEach(q => {
        q.parts.forEach(p => {
           const res = sub.results.itemized[p.id];
           row.push(res ? res.score : 0);
           row.push(`"${(res ? res.feedback : '').replace(/"/g, '""')}"`);
        });
      });

      row.push(sub.results.totalScore);
      row.push(sub.results.totalMax);
      row.push(`${sub.results.percentage}%`);

      csvContent += row.join(',') + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'math_quiz_grades_itemized.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderTabButton = (id, label, icon) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`flex items-center px-4 py-3 font-medium transition-colors border-b-2 ${
        activeTab === id 
          ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50' 
          : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
      }`}
    >
      {icon}
      <span className="ml-2">{label}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans">
      <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="bg-indigo-600 p-2 rounded-lg">
                <Calculator className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">AI Math Grader</h1>
            </div>
            
            <div className="flex items-center gap-4 text-sm">
              {user?.email ? (
                <div className="flex items-center gap-3">
                  <span className="text-slate-600 font-medium hidden sm:inline-block">{user.email}</span>
                  <button onClick={handleLogout} className="text-slate-500 hover:text-slate-800 font-medium bg-slate-100 px-3 py-1.5 rounded-lg transition-colors">Sign Out</button>
                </div>
              ) : (
                <button onClick={handleLogin} className="text-white bg-indigo-600 hover:bg-indigo-700 font-medium px-4 py-2 rounded-lg transition-colors">
                  Sign In
                </button>
              )}
            </div>
          </div>
          <nav className="flex space-x-2 -mb-px">
            {renderTabButton('setup', '1. Teacher Setup', <Settings className="w-4 h-4" />)}
            {renderTabButton('student', '2. Student Portal', <Users className="w-4 h-4" />)}
            {renderTabButton('results', '3. Grading & Results', <GraduationCap className="w-4 h-4" />)}
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        
        {isProcessing && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center max-w-sm w-full text-center">
              <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-1">Processing...</h3>
              <p className="text-sm text-slate-500">{processingStatus}</p>
            </div>
          </div>
        )}

        {activeTab === 'setup' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                <h2 className="text-lg font-bold text-slate-900">Quiz Configuration</h2>
              </div>
              
              <div className="p-6">
                {setupPhase === 1 && (
                  <div className="space-y-6">
                    <div className="grid md:grid-cols-2 gap-6">
                      <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 transition-colors">
                        <UploadCloud className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                        <h3 className="font-medium text-slate-900">Upload Questions (PDF)</h3>
                        <input type="file" accept=".pdf" onChange={(e) => handleFileUpload(e, 'questions')} className="mt-4 text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer" />
                        {questionsImages.length > 0 && <div className="mt-3 text-xs text-emerald-600 font-medium flex items-center justify-center gap-1"><CheckCircle className="w-3 h-3"/> Loaded {questionsImages.length} pages</div>}
                      </div>

                      <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 transition-colors">
                        <FileText className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                        <h3 className="font-medium text-slate-900">Upload Answer Key (PDF)</h3>
                        <input type="file" accept=".pdf" onChange={(e) => handleFileUpload(e, 'answers')} className="mt-4 text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer" />
                        {answerKeyText && <div className="mt-3 text-xs text-emerald-600 font-medium flex items-center justify-center gap-1"><CheckCircle className="w-3 h-3"/> Loaded</div>}
                      </div>
                    </div>

                    <div className="flex justify-end pt-4">
                      <button 
                        onClick={processQuestionsWithAI}
                        disabled={questionsImages.length === 0 || !answerKeyText}
                        className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        Extract Questions <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {setupPhase === 2 && (
                  <div className="space-y-4">
                    <div className="bg-indigo-50 text-indigo-800 p-4 rounded-lg flex items-start gap-3 mb-6">
                      <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-medium text-sm">Select Questions</h4>
                        <p className="text-xs mt-1 opacity-90">Select the questions (and their parsed sub-parts) to include.</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {extractedQuestions.map((q, idx) => {
                        const isSelected = selectedQuestions.some(sq => sq.id === q.id);
                        return (
                          <div 
                            key={q.id}
                            onClick={() => toggleQuestionSelection(q)}
                            className={`p-5 rounded-xl border-2 cursor-pointer transition-all ${
                              isSelected ? 'border-indigo-600 bg-indigo-50/20' : 'border-slate-200 hover:border-indigo-300'
                            }`}
                          >
                            <div className="flex gap-4">
                              <div className="pt-1">
                                {isSelected ? <CheckSquare className="w-5 h-5 text-indigo-600" /> : <div className="w-5 h-5 rounded border-2 border-slate-300" />}
                              </div>
                              <div className="flex-1">
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Question {idx + 1}</span>
                                {q.imageUrl && (
                                  <div className="my-3">
                                    <span className="text-[10px] text-slate-400 font-bold uppercase mb-1 block flex items-center gap-1"><ImageIcon className="w-3 h-3"/> Associated Figure</span>
                                    <img src={q.imageUrl} alt="Extracted Figure" className="max-h-48 border border-slate-200 rounded object-contain bg-white" />
                                  </div>
                                )}
                                <MathText text={q.text} className="text-slate-800 mt-1 font-medium mb-3" />
                                
                                {q.parts && q.parts.length > 0 && q.parts[0].label !== '' && (
                                  <div className="pl-4 border-l-2 border-slate-200 space-y-2 mt-2">
                                    {q.parts.map(p => (
                                      <div key={p.id} className="text-sm flex gap-2">
                                        <strong className="text-indigo-600">{p.label})</strong>
                                        <MathText text={p.text} className="text-slate-600" />
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex justify-between items-center pt-6 border-t mt-6">
                      <button onClick={() => setSetupPhase(1)} className="text-slate-500 hover:text-slate-700 font-medium px-4 py-2">Back</button>
                      <button onClick={() => setSetupPhase(3)} disabled={selectedQuestions.length === 0} className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-medium flex items-center gap-2">
                        Continue to Rubrics <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {setupPhase === 3 && (
                  <div className="space-y-8">
                    <p className="text-sm text-slate-600 mb-6">Define the rubrics for <strong>each individual part</strong> of the selected questions.</p>

                    {selectedQuestions.map((q, idx) => (
                      <div key={q.id} className="bg-white rounded-xl border border-slate-300 overflow-hidden">
                        <div className="bg-slate-100 px-5 py-3 border-b border-slate-200">
                           <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider block mb-1">Question {idx + 1}</span>
                           {q.imageUrl && (
                             <img src={q.imageUrl} alt="Extracted Figure" className="max-h-40 border border-slate-200 rounded object-contain bg-white mb-3" />
                           )}
                           <MathText text={q.text} className="text-slate-800 font-medium" />
                        </div>
                        
                        <div className="divide-y divide-slate-100">
                          {q.parts.map((p, pIdx) => (
                            <div key={p.id} className="p-5 flex flex-col md:flex-row gap-6">
                              <div className="md:w-1/3">
                                {p.label ? (
                                  <h4 className="font-semibold text-slate-700 flex gap-2">
                                    <span className="text-indigo-600">{p.label})</span>
                                    <MathText text={p.text} />
                                  </h4>
                                ) : (
                                  <h4 className="font-semibold text-slate-500 italic text-sm">Grading rules for this question</h4>
                                )}
                              </div>
                              <div className="md:w-2/3 space-y-4">
                                <div>
                                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Max Points</label>
                                  <input 
                                    type="number" min="1" value={p.maxPoints}
                                    onChange={(e) => updatePartConfig(q.id, p.id, 'maxPoints', e.target.value)}
                                    className="w-24 px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Grading Rubric</label>
                                  <textarea 
                                    rows={3} value={p.rubric}
                                    onChange={(e) => updatePartConfig(q.id, p.id, 'rubric', e.target.value)}
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    <div className="flex justify-between items-center pt-6 border-t mt-6">
                      <button onClick={() => setSetupPhase(2)} className="text-slate-500 font-medium px-4 py-2">Back</button>
                      <button onClick={finalizeSetup} className="bg-emerald-600 text-white px-8 py-3 rounded-lg font-bold shadow-sm">Finalize & Publish</button>
                    </div>
                  </div>
                )}
                
                {setupPhase === 4 && (
                   <div className="text-center py-12">
                     <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle className="w-8 h-8" /></div>
                     <h3 className="text-xl font-bold text-slate-900 mb-2">Quiz is Ready!</h3>
                     <button onClick={() => setActiveTab('student')} className="mt-4 bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-medium">Go to Student Portal</button>
                   </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'student' && (
          <div className="max-w-3xl mx-auto animate-in fade-in duration-500">
            {!quizConfig ? (
              <div className="text-center py-20 bg-white rounded-2xl shadow-sm border border-slate-200">
                <BookOpen className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900">No Active Quiz</h3>
              </div>
            ) : !user?.email ? (
               <div className="text-center py-20 bg-white rounded-2xl shadow-sm border border-slate-200">
                  <Users className="w-16 h-16 text-indigo-200 mx-auto mb-4" />
                  <h3 className="text-2xl font-bold text-slate-900 mb-2">Login Required</h3>
                  <p className="text-slate-500 mb-6">Please sign in with your school email to access the assessment.</p>
                  <button onClick={handleLogin} className="bg-indigo-600 text-white px-8 py-3 rounded-lg font-bold hover:bg-indigo-700 transition-colors">Sign in with Google</button>
               </div>
            ) : hasSubmitted ? (
               <div className="text-center py-20 bg-white rounded-2xl shadow-sm border border-slate-200">
                  <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle className="w-8 h-8" /></div>
                  <h3 className="text-2xl font-bold text-slate-900 mb-2">Submission Received</h3>
                  <button onClick={resetStudentPortal} className="mt-4 text-indigo-600 font-medium hover:underline">Submit another response</button>
               </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-indigo-600 text-white">
                  <h2 className="text-2xl font-bold">Math Assessment</h2>
                  <p className="text-indigo-100 text-sm mt-1">Logged in as: {user.email}</p>
                </div>
                
                <div className="p-6 md:p-8 space-y-10">
                  <div className="space-y-12">
                    {quizConfig.questions.map((q, idx) => (
                      <div key={q.id} className="space-y-6">
                        <div className="flex gap-3">
                          <span className="text-indigo-600 shrink-0 font-semibold text-xl">{idx + 1}.</span>
                          <div className="flex-1">
                            {q.imageUrl && (
                              <div className="mb-4">
                                <img src={q.imageUrl} alt="Question Figure" className="max-h-64 border border-slate-200 rounded shadow-sm object-contain bg-white" />
                              </div>
                            )}
                            <MathText text={q.text} className="font-semibold text-slate-900 text-xl" />
                          </div>
                        </div>
                        
                        <div className="pl-6 md:pl-8 space-y-8 border-l-2 border-indigo-50">
                          {q.parts.map((p) => (
                            <div key={p.id} className="space-y-3">
                              <div className="flex justify-between items-end mb-2">
                                {p.label && (
                                  <span className="font-bold text-slate-700 flex gap-2">
                                    <span className="text-indigo-600">{p.label})</span>
                                    <MathText text={p.text} />
                                  </span>
                                )}
                                <span className="shrink-0 text-slate-400 text-xs font-bold uppercase tracking-widest bg-slate-100 px-2 py-1 rounded">
                                  {p.maxPoints} pts
                                </span>
                              </div>
                              
                              <HybridEditor 
                                value={currentResponses[p.id] || ''}
                                onChange={(htmlVal) => setCurrentResponses({...currentResponses, [p.id]: htmlVal})}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-6">
                    <button onClick={handleStudentSubmit} className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg shadow-md hover:bg-indigo-700 transition-colors">
                      Submit Assessment
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'results' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Submissions & Grading</h2>
                <p className="text-slate-500 text-sm mt-1">{submissions.length} total responses recorded.</p>
              </div>
              <div className="flex gap-3">
                <button onClick={gradeAllSubmissions} disabled={submissions.filter(s => !s.graded).length === 0} className="bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium flex items-center gap-2 disabled:opacity-50">
                  <Play className="w-4 h-4 fill-current" /> Auto-Grade Pending
                </button>
                <button onClick={exportCSV} disabled={submissions.filter(s => s.graded).length === 0} className="bg-white border border-slate-300 text-slate-700 px-5 py-2.5 rounded-lg font-medium flex items-center gap-2 disabled:opacity-50">
                  <Download className="w-4 h-4" /> Export CSV
                </button>
              </div>
            </div>

            <div className="grid gap-6">
              {submissions.map((sub) => (
                <div key={sub.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                        {sub.studentName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900">{sub.studentName}</h3>
                        <p className="text-xs text-slate-500">{sub.studentEmail}</p>
                      </div>
                    </div>
                    {sub.graded ? (
                      <div className="text-right">
                        <div className="text-2xl font-black text-indigo-600">{sub.results.percentage}%</div>
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{sub.results.totalScore} / {sub.results.totalMax} pts</div>
                      </div>
                    ) : (
                      <span className="bg-amber-100 text-amber-800 text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Pending</span>
                    )}
                  </div>

                  {sub.graded && (
                    <div className="p-5 space-y-8">
                      {quizConfig?.questions.map((q, qIdx) => (
                        <div key={q.id}>
                           <div className="text-sm font-semibold text-slate-800 mb-3 bg-slate-100 p-3 rounded-lg border border-slate-200">
                             <div className="flex items-start gap-2">
                               <span className="shrink-0 text-slate-500">Q{qIdx + 1}:</span> 
                               <div>
                                 {q.imageUrl && <img src={q.imageUrl} alt="Figure" className="max-h-32 mb-2 border border-slate-200 rounded bg-white object-contain" />}
                                 <MathText text={q.text} className="inline-block" />
                               </div>
                             </div>
                           </div>
                           
                           <div className="space-y-4 pl-4">
                             {q.parts.map(p => {
                               const gradeResult = sub.results.itemized[p.id];
                               const studentHtml = sub.responses[p.id] || "";
                               
                               return (
                                 <div key={p.id} className="border border-slate-200 rounded-xl overflow-hidden grid md:grid-cols-2">
                                   <div className="p-4 border-b md:border-b-0 md:border-r border-slate-200">
                                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">
                                        Student Answer {p.label ? `(Part ${p.label})` : ''}
                                      </span>
                                      {studentHtml ? (
                                        <div 
                                          className="text-sm text-slate-800 leading-relaxed pointer-events-none" 
                                          dangerouslySetInnerHTML={{ __html: studentHtml }} 
                                        />
                                      ) : (
                                        <span className="italic text-slate-400 text-sm">No response.</span>
                                      )}
                                   </div>
                                   <div className="bg-indigo-50/30 p-4">
                                      <div className="flex items-center justify-between mb-2">
                                        <span className="text-[10px] font-bold text-indigo-800 uppercase tracking-wider">AI Evaluation</span>
                                        <span className={`text-sm font-black ${gradeResult.score === Number(p.maxPoints) ? 'text-emerald-600' : 'text-amber-600'}`}>
                                          {gradeResult.score} / {p.maxPoints} pts
                                        </span>
                                      </div>
                                      <p className="text-sm text-indigo-900/80 leading-relaxed">
                                        {gradeResult.feedback}
                                      </p>
                                   </div>
                                 </div>
                               )
                             })}
                           </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
