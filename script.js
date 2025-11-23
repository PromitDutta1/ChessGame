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

// Stockfish engine wrapper
var engine = null;
var engineReady = false;

// Online multiplayer
var firebaseApp = null;
var database = null;
var currentRoomId = null;
var isHost = false;
var onlineUnsub = null;

// Audio
var audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}
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

/* =======================
   Init Board & UI
   ======================= */
function initGame() {
  stopTimer();
  timerStarted = false;
  gameMode = $('#gameMode').val();
  aiDepth = parseInt($('#difficulty').val()) || 3;
  playerColor = $('#playerColor').val();
  var startSeconds = parseInt($('#timeControl').val());
  whiteTime = startSeconds; blackTime = startSeconds;
  gameActive = true;
  updateTimerDisplay();

  if(gameMode === 'local'){ $('#aiSettings').hide(); $('#undoRedoControls').hide(); }
  else if(gameMode === 'online'){ $('#aiSettings').hide(); $('#undoRedoControls').hide(); }
  else{ $('#aiSettings').show(); $('#undoRedoControls').show(); }

  game.reset();
  redoStack = [];
  isAiThinking = false;

  var config = {
  draggable: true,
  position: 'start',
  pieceTheme: 'assets/pieces/wood/{piece}.png', // <-- UPDATE THIS PATH
  onDragStart: onDragStart,
  onDrop: onDrop,
  onMouseoutSquare: onMouseoutSquare,
  onMouseoverSquare: onMouseoverSquare,
  onSnapEnd: onSnapEnd
};

  board = Chessboard('myBoard', config);
  board.orientation(playerColor);

  updateStatus();

  if(gameMode==='ai' && playerColor==='black'){ setTimeout(makeAiMove,250); }

  if(gameMode==='online' && currentRoomId){ subscribeToRoom(currentRoomId); }
  else { if(onlineUnsub){ onlineUnsub(); onlineUnsub=null; } }
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
  gameActive=false; stopTimer();
  $status.text('Game Over! '+colorWhoLost+' ran out of time.');
  playGameOverSound();
  alert(colorWhoLost+" ran out of time! Game Over.");
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
  if(game.game_over() || !gameActive || isAiThinking) return;
  if(gameMode==='ai'){ var turn = game.turn()==='w'?'white':'black'; if(turn!==playerColor) return;}
  var moves = game.moves({square:square,verbose:true});
  if(moves.length===0) return;
  greySquare(square);
  for(var i=0;i<moves.length;i++) greySquare(moves[i].to);
}
function onMouseoutSquare(square,piece){ removeGreySquares(); }

/* =======================
   Undo / Redo
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

/* =======================
   Status
   ======================= */
function updateStatus(){
  var status='';
  var moveColor = (game.turn()==='b')?'Black':'White';
  if(game.in_checkmate()){ status='Game Over: '+moveColor+' is in checkmate.'; gameActive=false; stopTimer(); alert(status); playGameOverSound(); }
  else if(game.in_draw()){ status='Game Over: Drawn position'; gameActive=false; stopTimer(); }
  else{ status = (!timerStarted)?'Waiting for First Move...':moveColor+' to move'+(game.in_check()?' (CHECK!)':''); }
  $status.text(status);
}

/* =======================
   Stockfish AI
   ======================= */
function ensureEngine(){
  if(engine && engineReady) return;
  engineReady=false;
  try{
    if(typeof STOCKFISH==='function'){ engine=STOCKFISH(); } 
    else if(typeof Stockfish==='function'){ engine=Stockfish(); } 
    else{ engine=new Worker('https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js'); }
  }catch(e){ engine=null; return; }

  if(!engine) return;
  engine.onmessage = function(event){
    var line = typeof event==='string'? event: (event.data||event);
    if(typeof line==='string' && line.indexOf('bestmove')===0){
      var parts=line.split(' ');
      if(parts[1]){
        var best=parts[1].trim();
        if(best && best!=='(none)'){
          game.move({from:best.substring(0,2),to:best.substring(2,4),promotion: best.length>4?best[4]:'q'});
          board.position(game.fen());
          isAiThinking=false;
          updateStatus();
          updateTimerDisplay();
          playMoveSound();
        }
      }
    }
  };
  try{ engine.postMessage('uci'); engine.postMessage('isready'); engineReady=true; } catch(e){ engineReady=false; }
}

function makeAiMove(){
  if(game.game_over() || !gameActive){ isAiThinking=false; return; }
  ensureEngine();

  if(engine && engineReady){
    engine.postMessage('ucinewgame');
    engine.postMessage('position fen '+game.fen());

    // Stockfish unbeatable settings
    engine.postMessage('setoption name Skill Level value 20');
    engine.postMessage('setoption name Contempt value 0');
    engine.postMessage('setoption name Threads value 4');
    engine.postMessage('setoption name Hash value 256');
    engine.postMessage('setoption name Ponder value true');
    engine.postMessage('setoption name MultiPV value 1');

    // Adaptive thinking
    if(aiDepth <= 3){
      var mappingDepth = {1:12,2:16,3:20};
      engine.postMessage('go depth '+(mappingDepth[aiDepth]||16));
    } else {
      var movetime = (aiDepth===4?3000: aiDepth===5?5000:10000); // 3s/5s/10s
      engine.postMessage('go movetime '+movetime);
    }
  } else {
    // fallback random move if engine fails
    var moves = game.moves();
    var move = moves[Math.floor(Math.random()*moves.length)];
    game.move(move);
    board.position(game.fen());
    isAiThinking=false;
    updateStatus();
    playMoveSound();
  }

  if(!timerStarted) startTimer();
}

/* =======================
   Online Multiplayer (Firebase)
   ======================= */
function pushMoveToRoom(roomId, fen, san){
  if(!firebase) return;
  var roomRef = firebase.database().ref('rooms/'+roomId);
  roomRef.update({fen:fen,lastSan:san,timestamp:Date.now()});
}

function subscribeToRoom(roomId){
  if(!firebase || !firebase.database) return;
  if(onlineUnsub){ onlineUnsub(); onlineUnsub=null; }
  var roomRef=firebase.database().ref('rooms/'+roomId);
  var listener=function(snapshot){
    var val=snapshot.val(); if(!val) return;
    if(val.fen && val.fen!==game.fen()){ game.load(val.fen); board.position(game.fen()); updateStatus(); }
  };
  roomRef.on('value',listener);
  onlineUnsub=function(){ roomRef.off('value',listener); };
}

$('#joinRoomBtn').on('click',async function(){
  var pref=$('#roomIdInput').val().trim();
  if(!firebase || !firebase.database){ alert('Firebase not configured.'); return; }
  if(pref){
    currentRoomId=pref; isHost=false; subscribeToRoom(currentRoomId);
    alert('Joined room: '+currentRoomId);
    var roomRef=firebase.database().ref('rooms/'+currentRoomId+'/fen');
    roomRef.once('value').then(function(snap){ var fen=snap.val(); if(fen){ game.load(fen); board.position(game.fen()); updateStatus(); }});
  }else{
    var id=Math.random().toString(36).slice(2,9);
    currentRoomId=id; isHost=true;
    firebase.database().ref('rooms/'+currentRoomId).set({fen:game.fen(),created:Date.now()}).then(function(){
      subscribeToRoom(currentRoomId);
      alert('Created room: '+currentRoomId+'\nShare this ID to invite.');
      $('#roomIdInput').val(currentRoomId);
    });
  }
  $('#gameMode').val('online'); initGame();
});

/* =======================
   Start / Reset
   ======================= */
$('#startBtn').on('click',initGame);
$('#resetBtn').on('click',initGame);
$('#gameMode').on('change',initGame);

$(document).ready(function(){
  initGame();
  setupFirebaseModuleLoader();
});

/* =======================
   Firebase Module Loader
   ======================= */
function setupFirebaseModuleLoader(){
  var moduleScript=document.createElement('script');
  moduleScript.type='module';
  moduleScript.text=`
    import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js';
    import { getDatabase, ref, onValue, set, update } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js';
    const firebaseConfig = {
      apiKey: "YOUR_API_KEY",
      authDomain: "YOUR_AUTH_DOMAIN",
      databaseURL: "YOUR_DATABASE_URL",
      projectId: "YOUR_PROJECT_ID",
      storageBucket: "YOUR_STORAGE_BUCKET",
      messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
      appId: "YOUR_APP_ID"
    };
    const app = initializeApp(firebaseConfig);
    const db = getDatabase(app);
    window.firebase={app:app,database:db,databaseRef:ref,databaseOnValue:onValue,databaseSet:set,databaseUpdate:update};
  `;
  document.body.appendChild(moduleScript);
}
