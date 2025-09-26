import { pieces } from './pieces.js';

console.log('script.js loaded');

/* ==========================
   1 — Utilities
   ========================== */
function hexToRgb(hex) {
  hex = (hex || '').replace('#','');
  if (hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
  return { r: parseInt(hex.slice(0,2) || '00',16), g: parseInt(hex.slice(2,4) || '00',16), b: parseInt(hex.slice(4,6) || '00',16) };
}

function rgbCss(c){ return `rgb(${c[0]},${c[1]},${c[2]})`; }

function pieceNameFromType(t) { 
  switch(t){ 
    case 'n': return 'Knight'; 
    case 'b': return 'Bishop'; 
    case 'r': return 'Rook'; 
    case 'q': return 'Queen'; 
    case 'k': return 'King'; 
    case 'p': return 'Pawn'; 
    default: return 'Piece'; 
  } 
}

function evalToPercent(numeric){ 
  if(Math.abs(numeric)>=50) return numeric>0?100:0; 
  const clamp=Math.max(-5,Math.min(5,numeric)); 
  return Math.max(0,Math.min(100,50+(clamp/5)*50)); 
}

/* ==========================
   2 — DOM & Canvas
   ========================== */
document.addEventListener('DOMContentLoaded',()=>{

  const BOARD_SIZE = 720, SQUARE_SIZE = BOARD_SIZE / 8;
  const canvas = document.getElementById('boardCanvas'), ctx = canvas.getContext('2d');
  canvas.width = canvas.height = BOARD_SIZE;

  const lightIn = document.getElementById('lightColor'), darkIn = document.getElementById('darkColor');
  const bgInput = document.getElementById('bgColor');
  const gradientToggle = document.getElementById('disableGradient');
  const darkModeToggle = document.getElementById('darkModeToggle');
  const turnText = document.getElementById('turnText'), suggsDiv = document.getElementById('suggestions');
  const evalWhiteCanvas = document.getElementById('evalWhite'), evalBlackCanvas = document.getElementById('evalBlack');
  const evalWhiteCtx = evalWhiteCanvas?.getContext('2d'), evalBlackCtx = evalBlackCanvas?.getContext('2d');

  const fetchBtn = document.getElementById("fetchPgnBtn");

  let lightColor = [160,120,200], darkColor = [255,250,200];
  if(lightIn) lightIn.oninput = e => lightColor = Object.values(hexToRgb(e.target.value));
  if(darkIn) darkIn.oninput = e => darkColor = Object.values(hexToRgb(e.target.value));

  const body = document.body;
  let gradientEnabled = true; // track if gradient is active

  // Page background
  if(bgInput){
    bgInput.oninput = e => {
      const val = e.target.value;
      if(gradientEnabled){
        body.style.background = `linear-gradient(45deg, ${val}, #4B0082, #8A2BE2, ${val})`;
        body.style.backgroundSize = '400% 400%';
        body.style.animation = 'gradientMove 30s ease infinite';
      } else {
        body.style.background = val;
        body.style.animation = 'none';
      }
    };
  }

  if(gradientToggle){
    gradientToggle.addEventListener('change', () => {
      gradientEnabled = !gradientToggle.checked;
      const val = bgInput?.value || '#000000';
      if(!gradientEnabled){
        body.style.background = val;
        body.style.animation = 'none';
      } else {
        body.style.background = `linear-gradient(45deg, ${val}, #4B0082, #8A2BE2, ${val})`;
        body.style.backgroundSize = '400% 400%';
        body.style.animation = 'gradientMove 30s ease infinite';
      }
    });
  }

  // Dark Mode toggle — glassy panels effect
  if(darkModeToggle){
    darkModeToggle.addEventListener('change', () => {
      if(darkModeToggle.checked){
        document.documentElement.style.setProperty('--panel-bg', 'rgba(20,20,40,0.6)');
        document.documentElement.style.setProperty('--text', '#fff');
        document.documentElement.style.setProperty('--highlight', '#A078C8');
      } else {
        document.documentElement.style.setProperty('--panel-bg', 'rgba(255,255,255,0.15)');
        document.documentElement.style.setProperty('--text', '#000');
        document.documentElement.style.setProperty('--highlight', '#A078C8');
      }
    });
  }

  // Square Names Toggle
  const squareNamesToggle = document.getElementById('squareNamesToggle');
  let showSquareNames = false;
  if(squareNamesToggle){
    squareNamesToggle.addEventListener('change', () => {
      showSquareNames = squareNamesToggle.checked;
    });
  }

  const PIECE_MAP = {P:'wP',N:'wN',B:'wB',R:'wR',Q:'wQ',K:'wK',p:'bP',n:'bN',b:'bB',r:'bR',q:'bQ',k:'bK'};
  const pieceImgs = {};

  function loadImages() {
    return Promise.all(Object.entries(PIECE_MAP).map(([sym,code]) => new Promise(res => {
      const src = pieces[code]; 
      if(!src) return res();
      const img = new Image();
      img.onload = () => { pieceImgs[sym] = img; res(); };
      img.onerror = () => res();
      img.src = src;
    })));
  }

  /* ==========================
     3 — Chess game
     ========================== */
  if(typeof window.Chess !== 'function') console.error('window.Chess missing');
  let game = new window.Chess();
  let selectedSquare = null, legalMoves = [];

  canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const file = Math.floor((e.clientX - rect.left)/SQUARE_SIZE);
    const rank = Math.floor((e.clientY - rect.top)/SQUARE_SIZE);
    const sq = String.fromCharCode(97+file) + (8-rank);

    if(!selectedSquare){
      const p = game.get(sq);
      if(p && p.color === game.turn()){
        selectedSquare = sq;
        legalMoves = game.moves({square: sq, verbose: true}).map(m=>m.to);
      }
    } else {
      if(legalMoves.includes(sq)){
        game.move({from:selectedSquare, to:sq, promotion:'q'});
        requestAnalysis();
        renderSuggestions();
      }
      selectedSquare = null;
      legalMoves = [];
    }
  });

  /* ==========================
     4 — Stockfish engine
     ========================== */
  let engine = null, engineReady = false, engineRequested = false;
  const engineTimeoutMs = 500, multiPV = 5;
  let pvMap = {}, lastFen = null, evalCp = 0, displayedWhite = 50, smoothing = 0.18;

  function initEngine(){
    try{ engine = new Worker('./lib/stockfish.js'); }
    catch(err){ return; }
    engine.onmessage = ev => {
      const line = typeof ev.data === 'string'? ev.data : (ev.data?.message || '');
      if(!line) return;
      if(line.startsWith('readyok')){ engineReady = true; requestAnalysis(); return; }
      if(line.startsWith('info')) parseInfoLine(line);
      if(line.startsWith('bestmove')){ engineRequested = false; renderSuggestions(); }
    };
    engine.postMessage('uci'); 
    engine.postMessage(`setoption name MultiPV value ${multiPV}`); 
    engine.postMessage('isready');
  }

  function requestAnalysis(){
    if(!engine || !engineReady) return;
    const fen = game.fen();
    if(engineRequested && fen === lastFen) return;
    engineRequested = true; 
    lastFen = fen; 
    pvMap = {}; 
    evalCp = 0;
    engine.postMessage('position fen '+fen);
    engine.postMessage('go movetime '+engineTimeoutMs);
  }

  function parseInfoLine(line){
    const mp = (line.match(/ multipv (\d+)/)?.[1]||1)|0;
    const scoreMatch = line.match(/ score (cp|mate) (-?\d+)/);
    if(!scoreMatch) return;
    const [_, scoreType, scoreValStr] = scoreMatch;
    const scoreVal = parseInt(scoreValStr,10);
    const pvText = (line.match(/ pv (.+)$/)?.[1]||'').trim();
    if(!pvText) return;
    const first = pvText.split(/\s+/)[0];
    const from = first.slice(0,2), to = first.slice(2,4);
    const pieceObj = game.get(from), text = `${pieceNameFromType(pieceObj?.type)} to ${to}`;
    let numericScore = scoreType==='cp'?scoreVal/100:(scoreVal>0?100:-100);
    pvMap[mp] = {move:first, from, to, numericScore, displayScore:(scoreType==='cp')?numericScore.toFixed(2):`Mate ${scoreVal}`, text};
    if(mp===1){ evalCp=numericScore; updateEvalBars(); }
    renderSuggestions(); // ensure panel updates live
  }

  /* ==========================
     5 — Suggestions UI (PGN vs Engine)
     ========================== */
  function renderSuggestions(){
    suggsDiv.innerHTML = ''; // clear previous
    const header = document.createElement('div'); 
    header.textContent = 'Your Move vs Engine:'; 
    header.style.fontWeight = '700'; 
    header.style.marginBottom = '6px';
    suggsDiv.appendChild(header);

    const history = game.history({ verbose: true });

    if(history.length === 0){
        const msg = document.createElement('div');
        msg.className = 'suggestion';
        msg.textContent = 'No moves played yet.';
        suggsDiv.appendChild(msg);
        return;
    }

    // If engine hasn't responded yet, show waiting
    if(!pvMap[1]){
        const msg = document.createElement('div');
        msg.className = 'suggestion';
        msg.textContent = 'Waiting for engine analysis…';
        suggsDiv.appendChild(msg);
        return;
    }

    // Loop through history and show engine suggestions
    history.forEach((move,i)=>{
        const engineBest = pvMap[1]; 
        const humanMoveText = `${pieceNameFromType(move.piece)} to ${move.to}`;
        const engineMoveText = engineBest 
            ? `${pieceNameFromType(game.get(engineBest.from)?.type || move.piece)} to ${engineBest.to}` 
            : '—';

        const d = document.createElement('div'); 
        d.className = 'suggestion';
        d.innerHTML = `<b>Move ${i+1} (${move.color === 'w' ? 'White':'Black'})</b><br>
                       You played: ${humanMoveText}<br>
                       Engine prefers: ${engineMoveText}`;
        suggsDiv.appendChild(d);
    });
  }

  /* ==========================
     6 — Evaluation bars
     ========================== */
  function evaluateBoard(game) {
    const pieceValues = { p:1, n:3, b:3, r:5, q:9, k:0 };
    let whiteScore = 0, blackScore = 0;
    const board = game.board();
    for(let r=0;r<8;r++){
      for(let f=0;f<8;f++){
        const p = board[r][f];
        if(!p) continue;
        const value = pieceValues[p.type] || 0;
        if(p.color==='w') whiteScore+=value; else blackScore+=value;
        if((r>=2 && r<=5)&&(f>=2 && f<=5)){
          if(p.color==='w') whiteScore+=0.2; else blackScore+=0.2;
        }
      }
    }
    const total = whiteScore + blackScore;
    return total>0 ? (whiteScore/total)*100 : 50;
  }

  function updateEvalBars(){
    const targetWhite = evaluateBoard(game);
    displayedWhite += (targetWhite - displayedWhite) * smoothing;
    drawEval(evalWhiteCtx,evalWhiteCanvas,displayedWhite,'#888','#444');
    drawEval(evalBlackCtx,evalBlackCanvas,100-displayedWhite,'#888','#444');
  }

  function drawEval(ctx,canvas,pct,colorFill,colorBg){
    if(!ctx||!canvas) return;
    const w=canvas.width,h=canvas.height;
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle=colorBg; ctx.fillRect(0,0,w,h);
    ctx.fillStyle=colorFill; ctx.fillRect(0,0,Math.round((pct/100)*w),h);
  }

  /* ==========================
     7 — Render loop
     ========================== */
  function drawBoardAndPieces(){
    for(let r=0;r<8;r++){
      for(let f=0;f<8;f++){
        const sq=String.fromCharCode(97+f)+(8-r);
        let color=((r+f)%2===0)?lightColor:darkColor;
        if(sq===selectedSquare) color=[100,200,255];
        else if(legalMoves.includes(sq)) color=[180,255,180];
        ctx.fillStyle=rgbCss(color); ctx.fillRect(f*SQUARE_SIZE,r*SQUARE_SIZE,SQUARE_SIZE,SQUARE_SIZE);
      }
    }

    if(showSquareNames){
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = `${SQUARE_SIZE*0.18}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for(let r=0;r<8;r++){
        for(let f=0;f<8;f++){
          const sq = String.fromCharCode(97+f) + (8-r);
          ctx.fillText(sq, f*SQUARE_SIZE + SQUARE_SIZE/2, r*SQUARE_SIZE + SQUARE_SIZE/2);
        }
      }
    }

    const board=game.board();
    for(let r=0;r<board.length;r++){
      for(let f=0;f<board[r].length;f++){
        const p=board[r][f]; if(!p) continue;
        const sym=p.color==='w'?p.type.toUpperCase():p.type;
        const img=pieceImgs[sym];
        if(img) ctx.drawImage(img,f*SQUARE_SIZE,r*SQUARE_SIZE,SQUARE_SIZE,SQUARE_SIZE);
        else{
          ctx.fillStyle=p.color==='w'?'#fff':'#000'; 
          ctx.beginPath(); 
          ctx.arc(f*SQUARE_SIZE+SQUARE_SIZE/2,r*SQUARE_SIZE+SQUARE_SIZE/2,SQUARE_SIZE*0.36,0,Math.PI*2); 
          ctx.fill();
        }
      }
    }
    if(turnText) turnText.textContent = game.turn() === 'w' ? 'White' : 'Black';
  }

  function loop(){ drawBoardAndPieces(); updateEvalBars(); requestAnimationFrame(loop); }

  // Theme panel toggle
  const themeToggle = document.getElementById('themeToggle');
  const themeOptions = document.getElementById('themeOptions');
  if(themeToggle) themeToggle.onclick = () => {
    if(themeOptions.style.display === 'none'){
      themeOptions.style.display = 'flex';
      themeToggle.textContent = 'Change Theme ▲';
    } else {
      themeOptions.style.display = 'none';
      themeToggle.textContent = 'Change Theme ▼';
    }
  };

  /* ==========================
     8 — Controls
     ========================== */
  document.getElementById('undoBtn').onclick = ()=>{ 
    game.undo(); 
    selectedSquare=null; legalMoves=[]; 
    requestAnalysis(); 
    renderSuggestions(); 
  };
  document.getElementById('redoBtn').onclick = ()=>{};
  document.getElementById('resetBtn').onclick = ()=>{ 
    game.reset(); 
    selectedSquare=null; legalMoves=[]; 
    requestAnalysis(); 
    renderSuggestions(); 
  };
  document.getElementById('saveBtn').onclick = ()=>{ 
    const a=document.createElement('a'); 
    a.href=URL.createObjectURL(new Blob([game.pgn()],{type:'text/plain'})); 
    a.download='game.pgn'; 
    a.click(); 
  };
  document.getElementById('loadBtn').onclick = ()=>document.getElementById('loadInput').click();
  document.getElementById('loadInput').onchange = e => { 
    const fr = new FileReader(); 
    fr.onload = ()=>{
        try {
            game.load_pgn(fr.result); 
            selectedSquare=null; legalMoves=[]; 
            requestAnalysis(); 
            renderSuggestions(); 
        } catch(err){
            console.error("Failed to load PGN:", err);
        }
    }; 
    fr.readAsText(e.target.files[0]); 
  };

  if(fetchBtn){
    fetchBtn.addEventListener('click', async () => {
      const url = document.getElementById("gameUrl").value.trim();
      const resultEl = document.getElementById("pgnResult");

      if (!url) {
        resultEl.textContent = "⚠️ Please paste a game link first.";
        return;
      }

      try {
        resultEl.textContent = "⏳ Fetching PGN...";
        const res = await fetch("http://localhost:3000/fetch-pgn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url })
        });
        const data = await res.json();

        if (data.ok) {
          resultEl.textContent = data.pgn;
          try {
            game.load_pgn(data.pgn);
            selectedSquare = null;
            legalMoves = [];
            requestAnalysis();
            renderSuggestions();
          } catch(err) {
            console.error("Failed to load PGN:", err);
            resultEl.textContent = "❌ Failed to load PGN onto board.";
          }
        } else {
          resultEl.textContent = "❌ Error: " + data.error;
        }
      } catch (err) {
        console.error(err);
        resultEl.textContent = "❌ Server error. Is backend running?";
      }
    });
  }

/* ==========================
   9 — Startup
   ========================== */
loadImages().then(() => { 
  initEngine(); 

  // If there’s already a PGN loaded (from file or fetch), analyze it immediately
  if(game.history().length > 0){
    requestAnalysis();
  }

  // Highlight first move if PGN has moves
  let firstMove = game.history({verbose:true})[0];
  if(firstMove){
    selectedSquare = firstMove.from;
    legalMoves = [firstMove.to];
  }

  renderSuggestions(); 
  requestAnimationFrame(loop); 
}).catch(err => { 
  console.error('Image load failed:', err);
  initEngine(); 
  renderSuggestions(); 
  requestAnimationFrame(loop); 
});
// Optional: continuously update engine suggestions even if no move made yet
setInterval(() => { 
  if(game.history().length > 0) requestAnalysis(); 
}, 2000);});
