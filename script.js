/* =======================
   Core game vars & UI
   ======================= */
var board = null;
var game = new Chess();
var $status = $('#statusText');

var gameMode = 'ai';
var aiDepth = 3;
var playerColor = 'white';
var isAiThinking = false;

var timerInterval = null;
var whiteTime = 600, blackTime = 600;
var gameActive = false, timerStarted = false;
var redoStack = [];

// Analysis Vars
var isAnalysis = false;
var analysisHistory = [];
var analysisIndex = -1;

// Stockfish engine wrapper
var engine = null;
var engineReady = false;

// Online multiplayer vars
var firebaseApp = null;
var database = null;
var currentRoomId = null;
var isHost = false;
var onlineUnsub = null;

// Audio Context
var audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

/* =======================
   Sound Functions
   ======================= */
function beep(freq,dur,when=0){
  ensureAudio();
  var o=audioCtx.createOscillator();
  var g=audioCtx.createGain();
  o.type='sine';
  o.frequency.value=freq;
  o.connect(g);
  g.connect(audioCtx.destination);
  g.gain.setValueAtTime(0.0001,audioCtx.currentTime+when);
  g.gain.exponentialRampToValueAtTime(0.2,audioCtx.currentTime+when+0.01);
  o.start(audioCtx.currentTime+when);
  g.gain.exponentialRampToValueAtTime(0.0001,audioCtx.currentTime+when+dur);
  o.stop(audioCtx.currentTime+when+dur+0.02);
}
function playMoveSound(){ beep(880,0.06); }
function playCaptureSound(){ beep(600,0.06); beep(400,0.04,0.06); }
function playCheckSound(){ beep(1200,0.12); }
function playGameOverSound(){ beep(200,0.6); }

function playDeathModeSound(){
  ensureAudio();
  // Create a deep, scary sawtooth wave
  var o = audioCtx.createOscillator();
  var g = audioCtx.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(100, audioCtx.currentTime);
  o.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 2);
  o.connect(g);
  g.connect(audioCtx.destination);
  g.gain.setValueAtTime(0.5, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 2);
  o.start();
  o.stop(audioCtx.currentTime + 2);
}

/* =======================
   Init Board & UI
   ======================= */
function initGame() {
  if(isAnalysis) exitAnalysis();

  stopTimer();
  timerStarted = false;
  gameMode = $('#gameMode').val();
  aiDepth = parseInt($('#difficulty').val()) || 3;
  playerColor = $('#playerColor').val();
  var startSeconds = parseInt($('#timeControl').val());
  whiteTime = startSeconds; blackTime = startSeconds;
  gameActive = true;
  updateTimerDisplay();
  $('#analyzeBtn').hide();
  
  // Check Death Mode on Init
  checkDeathMode(aiDepth);

  // Visibility Logic
  if(gameMode === 'local'){ 
      $('#aiSettings').hide(); 
      $('#undoRedoControls').hide(); 
      $('#gameActions').css('display','flex');
      $('#drawBtn').show(); 
  }
  else if(gameMode === 'online'){ 
      $('#aiSettings').hide(); 
      $('#undoRedoControls').hide(); 
      $('#gameActions').css('display','flex');
      $('#drawBtn').show(); 
  }
  else{ 
      // AI Mode
      $('#aiSettings').show(); 
      $('#undoRedoControls').show(); 
      $('#gameActions').css('display','flex');
      $('#drawBtn').hide(); 
  }

  game.reset();
  redoStack = [];
  isAiThinking = false;
  isAnalysis = false;

  var config = {
    draggable: true,
    position: 'start',
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png', 
    onDragStart: onDragStart,
    onDrop: onDrop,
    onMouseoutSquare: onMouseoutSquare,
    onMouseoverSquare: onMouseoverSquare,
    onSnapEnd: onSnapEnd
  };

  board = Chessboard('myBoard', config);
  board.orientation(playerColor);

  updateStatus();
  
  if(gameMode === 'ai') ensureEngine();

  if(gameMode==='ai' && playerColor==='black'){ setTimeout(makeAiMove,250); }

  if(gameMode==='online' && currentRoomId){ subscribeToRoom(currentRoomId); }
  else { if(onlineUnsub){ onlineUnsub(); onlineUnsub=null; } }
}

/* =======================
   Death Mode Logic
   ======================= */
// Listener for Difficulty Change
document.getElementById("difficulty").addEventListener("change", function(){
  aiDepth = Number(this.value);
  checkDeathMode(aiDepth);
});

function checkDeathMode(level) {
  let warning = document.getElementById("death-warning");
  if(level === 7){
    if(warning) warning.style.display = "block";
    playDeathModeSound();
    document.body.style.background = "black";
    document.body.style.color = "red";
  } else {
    if(warning) warning.style.display = "none";
    document.body.style.background = ""; // Reset
    document.body.style.color = "";
  }
}

/* =======================
   Timer
   ======================= */
function startTimer(){
  if(timerInterval) clearInterval(timerInterval);
  timerStarted=true;
  timerInterval=setInterval(function(){
    if(!gameActive) return;
    if(game.turn()==='w'){ whiteTime--; if(whiteTime<=0) endGameByTime('White'); }
    else { blackTime--; if(blackTime<=0) endGameByTime('Black'); }
    updateTimerDisplay();
  },1000);
}

function stopTimer(){ if(timerInterval) clearInterval(timerInterval); timerInterval=null; }

function endGameByTime(colorWhoLost){
  finishGame('Game Over! '+colorWhoLost+' ran out of time.');
}

function updateTimerDisplay(){
  function formatTime(t){ if(t>90000) return "∞"; var min=Math.floor(t/60); var sec=t%60; return (min<10?"0"+min:min)+":"+(sec<10?"0"+sec:sec); }
  $('#time-w').text(formatTime(whiteTime));
  $('#time-b').text(formatTime(blackTime));
  if(gameActive && timerStarted){
    if(game.turn()==='w'){$('#timer-white-container').addClass('active'); $('#timer-black-container').removeClass('active');}
    else{$('#timer-black-container').addClass('active'); $('#timer-white-container').removeClass('active');}
  }else{$('.timer-display').removeClass('active');}
}

/* =======================
   Drag/Drop
   ======================= */
function onDragStart(source,piece,position,orientation){
  if(isAnalysis) return false;
  if(game.game_over() || !gameActive || isAiThinking) return false;
  if(whiteTime<=0 || blackTime<=0) return false;
  if(gameMode==='ai'){
    if((playerColor==='white' && piece.search(/^b/)!==-1) || (playerColor==='black' && piece.search(/^w/)!==-1)) return false;
  }
}

function onDrop(source,target){
  var move=game.move({from:source,to:target,promotion:'q'});
  if(move===null) return 'snapback';
  if(move.captured) playCaptureSound(); else playMoveSound();
  if(game.in_check()) playCheckSound();
  redoStack=[];
  if(!timerStarted) startTimer();
  updateStatus();
  updateTimerDisplay();
  board.position(game.fen());

  if(gameMode==='online' && currentRoomId){ pushMoveToRoom(currentRoomId, game.fen(), move.san); }

  if(gameMode==='ai' && !game.game_over()){ isAiThinking=true; $status.text("AI is thinking..."); setTimeout(makeAiMove,120); }
}

function onSnapEnd(){ board.position(game.fen()); }

function removeGreySquares(){ $('#myBoard .square-55d63').css('background',''); }
function greySquare(square){ var $sq=$('#myBoard .square-'+square); var bg='#a9a9a9'; if($sq.hasClass('black-3c85d')) bg='#696969'; $sq.css('background',bg);}
function onMouseoverSquare(square,piece){ 
  if(isAnalysis) return;
  if(game.game_over() || !gameActive || isAiThinking) return;
  if(gameMode==='ai'){ var turn = game.turn()==='w'?'white':'black'; if(turn!==playerColor) return;}
  var moves = game.moves({square:square,verbose:true});
  if(moves.length===0) return;
  greySquare(square);
  for(var i=0;i<moves.length;i++) greySquare(moves[i].to);
}
function onMouseoutSquare(square,piece){ removeGreySquares(); }

/* =======================
   Undo / Redo / Reset / Resign / Draw
   ======================= */
$('#undoBtn').on('click',function(){
  if(gameMode==='local' || !gameActive || isAiThinking) return;
  var move1=game.undo(); if(!move1) return; redoStack.push(move1);
  var justMovedColor = move1.color;
  if(gameMode==='ai' && justMovedColor!==playerColor.charAt(0)){
    var move2=game.undo(); if(move2) redoStack.push(move2);
  }
  board.position(game.fen());
  updateStatus();
});

$('#redoBtn').on('click',function(){
  if(gameMode==='local' || !gameActive || isAiThinking) return;
  if(redoStack.length===0) return;
  var move=redoStack.pop();
  game.move(move);
  board.position(game.fen());
  updateStatus();
});

$('#resetBtn').on('click', function(){
    if(!gameActive) { initGame(); return; }
    if(confirm("Reset game?")){
        initGame();
    }
});

$('#resignBtn').on('click', function() {
    if(!gameActive) return;
    if(!confirm("Resign?")) return;
    var loser = (game.turn() === 'w') ? 'White' : 'Black';
    if(gameMode === 'ai') loser = (playerColor === 'white') ? 'White' : 'Black';
    var winner = (loser === 'White') ? 'Black' : 'White';
    if(gameMode === 'online' && currentRoomId) { pushGameEndToRoom(currentRoomId, winner + " won by resignation"); }
    finishGame(winner + " wins! (" + loser + " resigned)");
});

$('#drawBtn').on('click', function() {
    if(!gameActive) return;
    if(gameMode === 'local') {
        if(confirm("Offer draw?")) finishGame("Game Drawn (Agreed).");
    } else if(gameMode === 'online' && currentRoomId) {
        pushDrawOffer(currentRoomId, (game.turn() === 'w' ? 'white' : 'black'));
        alert("Draw offer sent.");
    }
});

/* =======================
   Updated Status & Banner Logic
   ======================= */
function updateStatus() {
  let status = '';
  let moveColor = (game.turn() === 'b') ? 'Black' : 'White';

  if (game.in_checkmate()) {
    let winner = (moveColor === 'White') ? 'Black' : 'White';
    status = `CHECKMATE — ${winner} Wins!`;

    gameActive = false;
    stopTimer();
    playGameOverSound();

    showEndGameBanner(`${winner} Wins by Checkmate!`, "winText");

    return;
  }

  if (game.in_draw()) {
    status = `Game over — Draw`;

    gameActive = false;
    stopTimer();
    
    showEndGameBanner(`Draw — Stalemate`, "drawText");
    return;
  }

  status = (!timerStarted)
    ? "Waiting for first move..."
    : `${moveColor} to move${game.in_check() ? " (CHECK!)" : ""}`;

  $status.text(status);
}

function showEndGameBanner(text, styleClass) {
  let banner = document.getElementById("endGameBanner");
  
  banner.innerHTML = text;
  banner.className = ""; 
  banner.classList.add("show", styleClass);

  setTimeout(() => {
    banner.classList.remove("show");
  }, 6000);
}

/* =======================
   Board Animations
   ======================= */
function triggerBoardWinAnimation(winner) {
  let boardElem = document.getElementById("myBoard");
  boardElem.classList.add("winner-animation");
  setTimeout(() => {
    boardElem.classList.remove("winner-animation");
  }, 4000);
}

function triggerBoardDrawAnimation() {
  let boardElem = document.getElementById("myBoard");
  boardElem.classList.add("draw-animation");
  setTimeout(() => {
    boardElem.classList.remove("draw-animation");
  }, 3000);
}

/* =======================
   Game Over Overlay
   ======================= */
function finishGame(reasonText) {
    gameActive = false;
    stopTimer();
    $status.text(reasonText);
    playGameOverSound();

    showEndGame(reasonText);

    $('#analyzeBtn').show();
    $('#gameActions').hide();
}

function showEndGame(result) {
    let overlay = document.getElementById("end-game-overlay");
    
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'end-game-overlay';
        overlay.className = 'hidden'; 
        overlay.innerHTML = `<div id="end-game-text" class="message"></div><span>🎉 Congrats!</span>`;
        document.body.appendChild(overlay);
    }

    const textElement = document.getElementById("end-game-text");
    if(textElement) textElement.textContent = result;

    overlay.classList.remove('win','lose','draw');
    if (result.toLowerCase().includes('draw')) overlay.classList.add('draw');
    else if (result.toLowerCase().includes(playerColor)) overlay.classList.add('lose');
    else overlay.classList.add('win');

    overlay.style.display = "flex";
    overlay.style.pointerEvents = "auto"; 

    overlay.classList.remove("hidden");
    overlay.classList.add("show");

    if (!document.getElementById("close-end-screen")) {
        const closeBtn = document.createElement("button");
        closeBtn.id = "close-end-screen";
        closeBtn.textContent = "✔ Continue / Analysis";
        closeBtn.style.marginTop = "25px";
        closeBtn.style.padding = "10px 20px";
        closeBtn.style.fontSize = "18px";
        closeBtn.style.borderRadius = "10px";
        closeBtn.style.cursor = "pointer";

        overlay.appendChild(closeBtn);

        closeBtn.addEventListener("click", () => {
            overlay.classList.add("hidden");
            overlay.style.pointerEvents = "none"; 
            initGame(); 
        });
    }
}

/* =======================
   Analysis Mode Logic
   ======================= */
$('#analyzeBtn').on('click', function() { startAnalysis(); });

function startAnalysis() {
    const overlay = document.getElementById("end-game-overlay");
    if(overlay) { overlay.classList.add("hidden"); overlay.style.pointerEvents = "none"; }

    isAnalysis = true; gameActive = false; stopTimer();
    analysisHistory = game.history({ verbose: true });
    analysisIndex = analysisHistory.length - 1;
    $('#gameSettings').hide();
    $('#analysisControls').show();
    $status.text("Analysis Mode");
    ensureEngine();
    updateAnalysisBoard();
}

function exitAnalysis() {
    isAnalysis = false;
    $('#gameSettings').show();
    $('#analysisControls').hide();
    initGame();
}

$('#exitAnalysisBtn').on('click', exitAnalysis);
$('#anStart').on('click', function(){ analysisIndex = -1; updateAnalysisBoard(); });
$('#anPrev').on('click', function(){ if(analysisIndex >= -1) analysisIndex--; updateAnalysisBoard(); });
$('#anNext').on('click', function(){ if(analysisIndex < analysisHistory.length - 1) analysisIndex++; updateAnalysisBoard(); });
$('#anEnd').on('click', function(){ analysisIndex = analysisHistory.length - 1; updateAnalysisBoard(); });

function updateAnalysisBoard() {
    var tempGame = new Chess();
    for(var i=0; i<=analysisIndex; i++) if(analysisHistory[i]) tempGame.move(analysisHistory[i]);
    board.position(tempGame.fen());
    $status.text("Move: " + (analysisIndex + 1) + " / " + analysisHistory.length);
    removeGreySquares();
    askEngineEval(tempGame.fen());
}

function askEngineEval(fen) {
    if(!engine || !engineReady) return;
    $('#evalScore').text("..."); $('#bestMove').text("...");
    engine.postMessage('stop');
    engine.postMessage('position fen ' + fen);
    engine.postMessage('go depth 15');
}

/* =======================
   Stockfish AI & Engine Handling
   ======================= */
async function ensureEngine(){
  if(engine && engineReady) return;
  engineReady = false;
  
  try {
    if(typeof STOCKFISH === 'function') engine = STOCKFISH();
    else {
        const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.0/stockfish.js');
        if (!response.ok) throw new Error('Network response was not ok');
        const scriptContent = await response.text();
        const blob = new Blob([scriptContent], { type: 'application/javascript' });
        engine = new Worker(URL.createObjectURL(blob));
    }
  } catch(e) {
    engine = null; return;
  }

  engine.onmessage = function(event){
    var line = typeof event==='string'? event: (event.data||event);
    
    if(line === 'uciok'){ engineReady = true; }

    if(!isAnalysis && line.startsWith("bestmove")){
      let parts = line.split(' ');
      let moveStr = parts[1];
      if(moveStr && moveStr !== '(none)'){
          game.move({ from: moveStr.substring(0,2), to: moveStr.substring(2,4), promotion:'q' });
          board.position(game.fen());
          isAiThinking = false;
          updateStatus();
          updateTimerDisplay();
          playMoveSound();
      }
    }

    if(isAnalysis && typeof line==='string') {
        if(line.indexOf('score cp') !== -1 || line.indexOf('score mate') !== -1) {
            var scoreMatch = line.match(/score cp (-?\d+)/);
            var mateMatch = line.match(/score mate (-?\d+)/);
            if(mateMatch) { $('#evalScore').text("Mate in " + mateMatch[1]); } 
            else if(scoreMatch) { var score = parseInt(scoreMatch[1]) / 100; $('#evalScore').text((score > 0 ? "+" : "") + score.toFixed(2)); }
        }
        if(line.indexOf(' pv ') !== -1) {
             var pvMatch = line.match(/ pv ([a-h][1-8][a-h][1-8])/);
             if(pvMatch && pvMatch[1]) { 
                 var bm = pvMatch[1]; 
                 $('#bestMove').text(bm); 
                 // Highlight logic...
             }
        }
    }
  };
  
  engine.postMessage("uci");
}

function makeAiMove(){
  if(game.game_over() || !gameActive){ 
    isAiThinking=false; 
    return; 
  }

  ensureEngine();
  if(engine && engineReady){
    engine.postMessage('ucinewgame');
    engine.postMessage('position fen ' + game.fen());

    var aiDepth = parseInt(document.getElementById("difficulty").value);

    // Difficulty map for normal levels
    var depthMapping = {
      1: 6,
      2: 10,
      3: 14,
      4: 18,
      5: 22,
      6: 28
    };

    if(aiDepth === 7){
      // ⚠️ MISSION IMPOSSIBLE MODE
      // Ultra-deep Stockfish thinking time.
      engine.postMessage("go movetime 5000"); // 5 seconds thinking
    } else {
      // Normal difficulty levels
      var depth = depthMapping[aiDepth] || 14;
      engine.postMessage("go depth " + depth);
    }

  } else {
    // Fallback random move (in case Stockfish fails)
    var moves = game.moves();
    var move = moves[Math.floor(Math.random() * moves.length)];
    game.move(move);
    board.position(game.fen());
    isAiThinking=false;
    updateStatus();
    playMoveSound();
  }

  if(!timerStarted) startTimer();
}

/* =======================
   Online Sync
   ======================= */
function pushMoveToRoom(roomId, fen, san){
  if(!window.firebase || !window.firebase.database) return;
  var db = window.firebase.database;
  var ref = window.firebase.databaseRef;
  var update = window.firebase.databaseUpdate;
  update(ref(db, 'rooms/'+roomId), {fen:fen,lastSan:san,timestamp:Date.now()});
}

function pushGameEndToRoom(roomId, text){
    if(!window.firebase || !window.firebase.database) return;
    window.firebase.databaseUpdate(window.firebase.databaseRef(window.firebase.database, 'rooms/'+roomId), {gameResult: text});
}

function pushDrawOffer(roomId, color){
    if(!window.firebase || !window.firebase.database) return;
    window.firebase.databaseUpdate(window.firebase.databaseRef(window.firebase.database, 'rooms/'+roomId), {drawOffer: color});
}

function subscribeToRoom(roomId){
  if(!window.firebase || !window.firebase.database) return;
  var db = window.firebase.database;
  var ref = window.firebase.databaseRef;
  var onValue = window.firebase.databaseOnValue;
  if(onlineUnsub){ onlineUnsub(); onlineUnsub=null; }
  
  var listener=onValue(ref(db, 'rooms/'+roomId), function(snapshot){
    var val=snapshot.val(); if(!val) return;
    if(val.fen && val.fen!==game.fen()){ game.load(val.fen); board.position(game.fen()); updateStatus(); }
    if(val.gameResult && gameActive) { finishGame("Online: " + val.gameResult); }
    if(val.drawOffer) {
        var myColor = $('#playerColor').val(); 
        if(val.drawOffer !== 'accepted' && val.drawOffer !== 'rejected') {
           if(confirm("Opponent offers a draw. Accept?")) {
               pushGameEndToRoom(roomId, "Draw agreed");
               window.firebase.databaseUpdate(ref(db, 'rooms/'+roomId), {drawOffer: 'accepted'});
           } else {
               window.firebase.databaseUpdate(ref(db, 'rooms/'+roomId), {drawOffer: 'rejected'});
           }
        }
    }
  });
  onlineUnsub=function(){};
}

$('#joinRoomBtn').on('click',async function(){
  var pref=$('#roomIdInput').val().trim();
  if(!window.firebase || !window.firebase.database){ alert('Firebase not configured.'); return; }
  var db = window.firebase.database; var ref = window.firebase.databaseRef; var set = window.firebase.databaseSet;
  if(pref){
    currentRoomId=pref; isHost=false; subscribeToRoom(currentRoomId);
    alert('Joined room: '+currentRoomId);
  }else{
    var id=Math.random().toString(36).slice(2,9);
    currentRoomId=id; isHost=true;
    set(ref(db, 'rooms/'+currentRoomId), {fen:game.fen(),created:Date.now()});
    subscribeToRoom(currentRoomId);
    alert('Created room: '+currentRoomId+'\nShare this ID.');
    $('#roomIdInput').val(currentRoomId);
  }
  $('#gameMode').val('online'); initGame();
});

/* =======================
   Start / Reset
   ======================= */
$('#startBtn').on('click',initGame);
$('#gameMode').on('change',initGame);

$(document).ready(function(){
  initGame();
  setupFirebaseModuleLoader();
});

function setupFirebaseModuleLoader(){
  var moduleScript=document.createElement('script');
  moduleScript.type='module';
  moduleScript.text=`
    import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js';
    import { getDatabase, ref, onValue, set, update } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js';
    const firebaseConfig = { apiKey: "YOUR_API_KEY", authDomain: "YOUR_AUTH_DOMAIN", databaseURL: "YOUR_DATABASE_URL", projectId: "YOUR_PROJECT_ID", storageBucket: "YOUR_STORAGE_BUCKET", messagingSenderId: "YOUR_MESSAGING_SENDER_ID", appId: "YOUR_APP_ID" };
    try { const app = initializeApp(firebaseConfig); const db = getDatabase(app); window.firebase={app:app,database:db,databaseRef:ref,databaseOnValue:onValue,databaseSet:set,databaseUpdate:update}; } catch(e) { console.log("Firebase not configured"); }
  `;
  document.body.appendChild(moduleScript);
}
