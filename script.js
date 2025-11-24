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
var currentRoomId = null;
var isHost = false;
var onlineUnsub = null;

// Audio Context
var audioCtx = null;
function ensureAudio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }

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
   Init Game
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
  
  checkDeathMode(aiDepth);

  // UI visibility
  if(gameMode==='local' || gameMode==='online'){ 
      $('#aiSettings').hide(); 
      $('#undoRedoControls').hide(); 
      $('#gameActions').css('display','flex'); 
      $('#drawBtn').show(); 
  } else { 
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
    onMouseoverSquare: onMouseoverSquare,
    onMouseoutSquare: onMouseoutSquare,
    onSnapEnd: onSnapEnd
  };

  board = Chessboard('myBoard', config);
  board.orientation(playerColor);

  updateStatus();
  
  if(gameMode==='ai') ensureEngine();
  if(gameMode==='ai' && playerColor==='black'){ setTimeout(makeAiMove,250); }
  if(gameMode==='online' && currentRoomId){ subscribeToRoom(currentRoomId); }
  else { if(onlineUnsub){ onlineUnsub(); onlineUnsub=null; } }
}

/* =======================
   Death Mode
   ======================= */
document.getElementById("difficulty").addEventListener("change", function(){
  aiDepth = Number(this.value);
  checkDeathMode(aiDepth);
});

function checkDeathMode(level){
  let warning = document.getElementById("death-warning");
  if(level===7){
    if(warning) warning.style.display = "block";
    playDeathModeSound();
    document.body.style.background = "black";
    document.body.style.color = "red";
  } else {
    if(warning) warning.style.display = "none";
    document.body.style.background = "";
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

function endGameByTime(color){ finishGame(color+" ran out of time."); }

function updateTimerDisplay(){
  function formatTime(t){ if(t>90000) return "∞"; var min=Math.floor(t/60); var sec=t%60; return (min<10?"0"+min:min)+":"+(sec<10?"0"+sec:sec); }
  $('#time-w').text(formatTime(whiteTime));
  $('#time-b').text(formatTime(blackTime));
  if(gameActive && timerStarted){
    if(game.turn()==='w'){$('#timer-white-container').addClass('active'); $('#timer-black-container').removeClass('active');}
    else{$('#timer-black-container').addClass('active'); $('#timer-white-container').removeClass('active');}
  } else $('.timer-display').removeClass('active');
}

/* =======================
   Drag & Drop
   ======================= */
function onDragStart(source,piece){ 
  if(isAnalysis || game.game_over() || !gameActive || isAiThinking) return false;
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
  board.position(game.fen());

  if(gameMode==='online' && currentRoomId){ pushMoveToRoom(currentRoomId, game.fen(), move.san); }

  if(gameMode==='ai' && !game.game_over()){ 
    isAiThinking=true; 
    $status.text("AI is thinking..."); 
    setTimeout(makeAiMove,120); 
  }
}

function onSnapEnd(){ board.position(game.fen()); }
function removeGreySquares(){ $('#myBoard .square-55d63').css('background',''); }
function greySquare(square){ var $sq=$('#myBoard .square-'+square); var bg='#a9a9a9'; if($sq.hasClass('black-3c85d')) bg='#696969'; $sq.css('background',bg);}
function onMouseoverSquare(square){ 
  if(isAnalysis || game.game_over() || !gameActive || isAiThinking) return;
  if(gameMode==='ai'){ var turn = game.turn()==='w'?'white':'black'; if(turn!==playerColor) return;}
  var moves = game.moves({square:square,verbose:true}); if(moves.length===0) return;
  greySquare(square);
  for(var i=0;i<moves.length;i++) greySquare(moves[i].to);
}
function onMouseoutSquare(){ removeGreySquares(); }

/* =======================
   Undo / Redo / Reset / Resign / Draw
   ======================= */
$('#undoBtn').click(function(){
  if(gameMode==='local' || !gameActive || isAiThinking) return;
  var move1=game.undo(); if(!move1) return; redoStack.push(move1);
  if(gameMode==='ai' && move1.color!==playerColor.charAt(0)){ var move2=game.undo(); if(move2) redoStack.push(move2); }
  board.position(game.fen()); updateStatus();
});

$('#redoBtn').click(function(){
  if(gameMode==='local' || !gameActive || isAiThinking) return;
  if(redoStack.length===0) return;
  var move=redoStack.pop();
  game.move(move);
  board.position(game.fen());
  updateStatus();
});

$('#resetBtn').click(function(){ if(confirm("Reset game?")) initGame(); });
$('#resignBtn').click(function(){
  if(!gameActive) return;
  var loser=(game.turn()==='w')?'White':'Black';
  if(gameMode==='ai') loser = (playerColor==='white')?'White':'Black';
  var winner=(loser==='White')?'Black':'White';
  if(gameMode==='online' && currentRoomId) pushGameEndToRoom(currentRoomId, winner+" won by resignation");
  finishGame(winner + " wins! ("+loser+" resigned)");
});
$('#drawBtn').click(function(){
  if(!gameActive) return;
  if(gameMode==='local'){ if(confirm("Offer draw?")) finishGame("Draw agreed."); }
  else if(gameMode==='online' && currentRoomId){ pushDrawOffer(currentRoomId, (game.turn()==='w'?'white':'black')); alert("Draw offer sent."); }
});

/* =======================
   Stockfish AI
   ======================= */
async function ensureEngine(){  
  if(engine && engineReady) return;  
  engineReady=false;
  try{
    if(typeof STOCKFISH==='function') engine=STOCKFISH();
    else { const response=await fetch('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.0/stockfish.js'); const blob=new Blob([await response.text()],{type:'application/javascript'}); engine=new Worker(URL.createObjectURL(blob)); }
  }catch(e){ engine=null; return; }

  engine.onmessage=function(event){
    var line=typeof event==='string'?event:(event.data||event);
    if(line==='uciok'){ engineReady=true; }
    if(!isAnalysis && line.startsWith("bestmove")){
      let parts=line.split(' '); let moveStr=parts[1];
      if(moveStr && moveStr!=='(none)'){ game.move({from:moveStr.substring(0,2),to:moveStr.substring(2,4),promotion:'q'}); board.position(game.fen()); isAiThinking=false; updateStatus(); updateTimerDisplay(); playMoveSound(); }
    }
  };

  engine.postMessage("uci");
}

function makeAiMove(){
  if(game.game_over() || !gameActive){ isAiThinking=false; return; }
  ensureEngine();
  if(engine && engineReady){
    engine.postMessage('ucinewgame');
    engine.postMessage('position fen ' + game.fen());
    var depthMapping={1:6,2:10,3:14,4:18,5:22,6:28};
    if(aiDepth===7) engine.postMessage("go movetime 5000");
    else engine.postMessage("go depth "+(depthMapping[aiDepth]||14));
  } else {
    var moves=game.moves();
    var move=moves[Math.floor(Math.random()*moves.length)];
    game.move(move); board.position(game.fen()); isAiThinking=false; updateStatus(); playMoveSound();
  }
  if(!timerStarted) startTimer();
}

/* =======================
   Online Multiplayer (Firebase v8)
   ======================= */
function pushMoveToRoom(roomId, fen, san){
  if(!db) return;
  db.ref('rooms/'+roomId).update({fen:fen,lastSan:san,timestamp:Date.now()});
}
function pushGameEndToRoom(roomId,text){
  if(!db) return;
  db.ref('rooms/'+roomId).update({gameResult:text});
}
function pushDrawOffer(roomId,color){
  if(!db) return;
  db.ref('rooms/'+roomId).update({drawOffer:color});
}
function subscribeToRoom(roomId){
  if(!db) return;
  if(onlineUnsub){ onlineUnsub(); onlineUnsub=null; }
  const roomRef=db.ref('rooms/'+roomId);
  const listener=roomRef.on('value',function(snapshot){
    const val=snapshot.val(); if(!val) return;
    if(val.fen && val.fen!==game.fen()){ game.load(val.fen); board.position(game.fen()); updateStatus(); }
    if(val.gameResult && gameActive){ finishGame("Online: "+val.gameResult); }
    if(val.drawOffer){
      if(val.drawOffer!=='accepted' && val.drawOffer!=='rejected'){
        if(confirm("Opponent offers a draw. Accept?")){
          pushGameEndToRoom(roomId,"Draw agreed");
          roomRef.update({drawOffer:'accepted'});
        } else { roomRef.update({drawOffer:'rejected'}); }
      }
    }
  });
  onlineUnsub=function(){ roomRef.off('value',listener); };
}

/* =======================
   Join Room Button
   ======================= */
$('#joinRoomBtn').click(function(){
  const roomId=$('#roomIdInput').val().trim();
  if(!roomId){ alert("Enter a Room ID."); return; }
  currentRoomId=roomId;
  initGame();
  subscribeToRoom(currentRoomId);
  alert("Joined room: "+currentRoomId);
});

/* =======================
   Analysis Mode
   ======================= */
$('#analyzeBtn').click(startAnalysis);
function startAnalysis(){
  isAnalysis=true; gameActive=false; stopTimer();
  analysisHistory=game.history({verbose:true});
  analysisIndex=analysisHistory.length-1;
  $('#gameSettings').hide();
  $('#analysisControls').show();
  $status.text("Analysis Mode");
  ensureEngine();
  updateAnalysisBoard();
}
function exitAnalysis(){ isAnalysis=false; $('#gameSettings').show(); $('#analysisControls').hide(); initGame(); }
$('#exitAnalysisBtn').click(exitAnalysis);
$('#anStart').click(()=>{ analysisIndex=-1; updateAnalysisBoard(); });
$('#anPrev').click(()=>{ if(analysisIndex>=-1) analysisIndex--; updateAnalysisBoard(); });
$('#anNext').click(()=>{ if(analysisIndex<analysisHistory.length-1) analysisIndex++; updateAnalysisBoard(); });
$('#anEnd').click(()=>{ analysisIndex=analysisHistory.length-1; updateAnalysisBoard(); });
function updateAnalysisBoard(){
  var tempGame=new Chess();
  for(var i=0;i<=analysisIndex;i++) if(analysisHistory[i]) tempGame.move(analysisHistory[i]);
  board.position(tempGame.fen());
  $status.text("Move: "+(analysisIndex+1)+" / "+analysisHistory.length);
  removeGreySquares();
}

/* =======================
   End-Game & UI
   ======================= */
function finishGame(reasonText){
  gameActive=false; stopTimer(); $status.text(reasonText); playGameOverSound(); showEndGame(reasonText);
  $('#analyzeBtn').show(); $('#gameActions').hide();
}
function showEndGame(result){
  let overlay=document.getElementById("end-game-overlay");
  if(!overlay){ overlay=document.createElement('div'); overlay.id='end-game-overlay'; overlay.className='hidden'; overlay.innerHTML=`<div id="end-game-text"></div>`; document.body.appendChild(overlay);}
  const textElement=document.getElementById("end-game-text"); if(textElement) textElement.textContent=result;
  overlay.style.display="flex"; overlay.style.pointerEvents="auto"; overlay.classList.remove("hidden");
  if(!document.getElementById("close-end-screen")){
    const closeBtn=document.createElement("button");
    closeBtn.id="close-end-screen"; closeBtn.textContent="✔ Continue / Analysis";
    closeBtn.addEventListener("click",()=>{ overlay.classList.add("hidden"); overlay.style.pointerEvents="none"; initGame(); });
    overlay.appendChild(closeBtn);
  }
}

/* =======================
   Start / Init
   ======================= */
$('#startBtn').click(initGame);
$('#gameMode').change(initGame);

$(document).ready(function(){ initGame(); });
