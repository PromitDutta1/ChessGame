/* =========================================================================
   PART 1: CONFIG, AUTH, AND SOUND ENGINE
   ========================================================================= */

// 1. FIREBASE INITIALIZATION
const firebaseConfig = {
  apiKey: "AIzaSyB_Xz-MtXJD5nHfElP5MmhN2T6iNJlYMSk",
  authDomain: "procheeser-824bf.firebaseapp.com",
  projectId: "procheeser-824bf",
  storageBucket: "procheeser-824bf.firebasestorage.app",
  messagingSenderId: "1073557932074",
  appId: "1:1073557932074:web:6ba905d0b6caeee61d9b53",
  measurementId: "G-D94BYJCPDW",
  databaseURL: "https://procheeser-824bf-default-rtdb.firebaseio.com/"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.database();
const provider = new firebase.auth.GoogleAuthProvider();

// 2. GLOBAL VARIABLES
var board = null;
var game = new Chess();
var $status = $('#statusText');

var gameMode = 'ai'; // 'ai', 'local', 'online_friend', 'online_random'
var aiDepth = 3;
var playerColor = 'white';
var isAiThinking = false;

var timerInterval = null;
var whiteTime = 600;
var blackTime = 600;
var gameActive = false;
var timerStarted = false;
var redoStack = [];

// --- NEW: Tap-to-Move Variable ---
var selectedSquare = null; 

// Analysis State
var isAnalysis = false;
var analysisHistory = [];
var analysisIndex = -1;

// Stockfish Engine
var engine = null;
var engineReady = false;

// Online State
var currentUser = null; 
var currentRoomId = null;
var onlineUnsub = null;

// Audio Context
var audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

// 3. AUTHENTICATION HANDLERS
$('#loginBtn').on('click', () => {
    auth.signInWithPopup(provider).catch(e => alert(e.message));
});

$('#logoutBtn').on('click', () => {
    auth.signOut();
    location.reload();
});

auth.onAuthStateChanged(user => {
    currentUser = user;
    if (user) {
        $('#authContainer').hide();
        $('#userInfo').css('display', 'flex');
        $('#userName').text(user.displayName.split(' ')[0]);
        $('#userAvatar').attr('src', user.photoURL);
        $('#bottomPlayerLabel').text(user.displayName);
    } else {
        $('#authContainer').show();
        $('#userInfo').hide();
        $('#bottomPlayerLabel').text("You (Guest)");
    }
});

// 4. SOUND ENGINE
function beep(freq, dur, when = 0) {
  ensureAudio();
  var o = audioCtx.createOscillator();
  var g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  o.connect(g);
  g.connect(audioCtx.destination);
  g.gain.setValueAtTime(0.0001, audioCtx.currentTime + when);
  g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + when + 0.01);
  o.start(audioCtx.currentTime + when);
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + when + dur);
  o.stop(audioCtx.currentTime + when + dur + 0.02);
}

function playMoveSound() { 
    beep(880, 0.06); 
}

function playCaptureSound() { 
    beep(600, 0.06); 
    beep(400, 0.04, 0.06); 
}

function playCheckSound() { 
    beep(1200, 0.12); 
}

function playGameOverSound() { 
    beep(200, 0.6); 
}

function playDeathModeSound() {
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

// 5. INITIALIZATION & UI SETUP
$('#gameMode').on('change', function() {
    $('.mode-options').hide();
    let mode = $(this).val();
    if(mode === 'ai') {
        $('#aiOptions').show();
    } else if(mode === 'local') {
        $('#localOptions').show();
    } else if(mode === 'online_friend') {
        $('#friendOptions').show();
    } else if(mode === 'online_random') {
        $('#randomOptions').show();
    }
});

$('#startAiBtn').on('click', () => initGame('ai'));
$('#startLocalBtn').on('click', () => initGame('local'));
$('#joinCreateBtn').on('click', () => initOnlineFriend());
$('#findMatchBtn').on('click', () => initOnlineRandom());

function initGame(mode, roomId = null, assignedColor = null) {
  if(isAnalysis) exitAnalysis();

  stopTimer();
  timerStarted = false;
  
  if(onlineUnsub) {
      onlineUnsub(); 
      onlineUnsub = null;
  }
  
  gameMode = mode || 'ai';
  currentRoomId = roomId;
  
  // Settings
  aiDepth = parseInt($('#difficulty').val()) || 3;
  checkDeathMode(aiDepth); 

  if(gameMode === 'ai') {
      playerColor = $('#aiColor').val();
  } else if(gameMode.includes('online')) {
      playerColor = assignedColor || 'white';
  } else {
      playerColor = 'white';
  }

  var startSeconds = parseInt($('#timeControl').val());
  whiteTime = startSeconds; 
  blackTime = startSeconds;
  
  gameActive = true;
  updateTimerDisplay();
  
  // UI States
  $('#analyzeBtn').hide();
  $('#gameSettings').hide();
  $('#inGameControls').show();
  
  if(gameMode === 'local') { 
      $('#undoRedoControls').hide(); 
      $('#drawBtn').hide(); 
  } else if(gameMode.includes('online')) { 
      $('#undoRedoControls').hide(); 
      $('#drawBtn').show(); 
  } else { 
      $('#undoRedoControls').show(); 
      $('#drawBtn').hide(); 
  }

  game.reset();
  redoStack = [];
  isAiThinking = false;
  isAnalysis = false;
  
  // Clear any existing tap selections
  selectedSquare = null;
  removeHighlights();

  var config = {
    draggable: true,
    position: 'start',
    orientation: playerColor,
    pieceTheme: 'assets/pieces/{piece}.png', 
    onDragStart: onDragStart,
    onDrop: onDrop,
    onMouseoutSquare: onMouseoutSquare,
    onMouseoverSquare: onMouseoverSquare,
    onSnapEnd: onSnapEnd
  };

  board = Chessboard('myBoard', config);

  updateStatus();
  
  if(gameMode === 'ai') {
      ensureEngine();
      if(playerColor === 'black') {
          setTimeout(makeAiMove, 250);
      }
  } else if(gameMode.includes('online')) {
      subscribeToRoom(currentRoomId);
  }
}
/* =========================================================================
   PART 2: TAP-TO-MOVE LOGIC (Added & Fixed)
   ========================================================================= */

function highlightSquare(square) {
    var $square = $('#myBoard .square-' + square);
    $square.addClass('highlight-selected');
}

function removeHighlights() {
    $('#myBoard .square-55d63').removeClass('highlight-selected');
    $('#myBoard .square-55d63').css('background', '');
}

function handleSquareClick(square) {
    // Basic Safety Checks
    if(!gameActive || isAiThinking || isAnalysis) return;
    if(whiteTime <= 0 || blackTime <= 0) return;

    // 1. First Click (Select Piece)
    if (!selectedSquare) {
        var piece = game.get(square);
        // Check if it is your piece
        if (!piece || piece.color !== game.turn()) return;
        
        // Restrictions
        if (gameMode === 'ai' && piece.color !== playerColor.charAt(0)) return;
        if (gameMode.includes('online') && piece.color !== playerColor.charAt(0)) return;
        if (gameMode.includes('online') && $status.text().includes("Searching")) return;

        selectedSquare = square;
        highlightSquare(square);
        return;
    }

    // 2. Second Click (Action)
    
    // FIX: If clicking the exact same square -> DESELECT
    if (square === selectedSquare) {
        selectedSquare = null;
        removeHighlights();
        return;
    }

    // FIX: If clicking another one of own pieces -> CHANGE SELECTION
    var piece = game.get(square);
    if (piece && piece.color === game.turn()) {
        selectedSquare = square;
        removeHighlights();
        highlightSquare(square);
        return;
    }

    // Try Move
    var move = game.move({ 
        from: selectedSquare, 
        to: square, 
        promotion: 'q' // Always promote to Queen on tap
    });

    // Invalid Move? Deselect
    if (move === null) {
        selectedSquare = null;
        removeHighlights();
        return;
    }

    // Valid Move
    selectedSquare = null;
    removeHighlights();
    
    // Update Board
    board.position(game.fen());
    
    if (move.captured) playCaptureSound(); 
    else playMoveSound();
    
    if (game.in_check()) playCheckSound();
    
    updateStatus(); 
    updateTimerDisplay();
    
    if (!timerStarted) startTimer();
    redoStack = [];

    // Sync & AI Logic
    if (gameMode.includes('online') && currentRoomId) {
        pushMoveToRoom(currentRoomId, game.fen(), move.san);
    }
    
    if (gameMode === 'ai' && !game.game_over()) { 
        isAiThinking = true; 
        $status.text("AI is thinking..."); 
        setTimeout(makeAiMove, 250); 
    }
}

/* =========================================================================
   PART 3: ONLINE MATCHMAKING, AI LOGIC, AND GAME LOOP
   ========================================================================= */

// 6. ONLINE MATCHMAKING
async function initOnlineRandom() {
    if (!currentUser) { 
        alert("Login required."); 
        return; 
    }
    $('#findMatchBtn').text("Searching...");
    
    const snap = await db.ref('rooms').orderByChild('status').equalTo('waiting_random').limitToFirst(1).get();

    if (snap.exists()) {
        const rid = Object.keys(snap.val())[0];
        if (snap.val()[rid].hostUid !== currentUser.uid) {
             await db.ref('rooms/' + rid).update({
                status: 'playing',
                blackPlayer: currentUser.uid,
                blackName: currentUser.displayName
            });
            initGame('online_random', rid, 'black');
            return;
        }
    }

    const newRid = db.ref('rooms').push().key;
    await db.ref('rooms/' + newRid).set({
        status: 'waiting_random',
        hostUid: currentUser.uid,
        whitePlayer: currentUser.uid,
        whiteName: currentUser.displayName,
        fen: 'start',
        created: firebase.database.ServerValue.TIMESTAMP
    });
    initGame('online_random', newRid, 'white');
    $status.text("Searching for opponent...");
}

async function initOnlineFriend() {
    let roomId = $('#roomIdInput').val().trim();
    let chosenColor = $('#friendColor').val();

    if (!roomId) {
        roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        let hc = chosenColor === 'random' ? (Math.random()<0.5?'white':'black') : chosenColor;
        
        await db.ref('rooms/' + roomId).set({
            fen: 'start',
            status: 'waiting',
            hostColor: hc,
            whitePlayer: (hc==='white'?currentUser.uid:null),
            blackPlayer: (hc==='black'?currentUser.uid:null),
            created: firebase.database.ServerValue.TIMESTAMP
        });
        $('#roomIdInput').val(roomId);
        alert(`Room Created: ${roomId}`);
        initGame('online_friend', roomId, hc);
    } else {
        const snap = await db.ref('rooms/' + roomId).get();
        if(!snap.exists()) { 
            alert("Room not found!"); 
            return; 
        }
        
        let myC = snap.val().whitePlayer ? 'black' : 'white';
        await db.ref('rooms/' + roomId).update({ status: 'playing' });
        initGame('online_friend', roomId, myC);
    }
}

function subscribeToRoom(roomId){
  if(onlineUnsub){ 
      onlineUnsub(); 
      onlineUnsub = null; 
  }
  
  const roomRef = db.ref('rooms/' + roomId);
  onlineUnsub = roomRef.on('value', (snapshot) => {
    var val=snapshot.val(); 
    if(!val) return;
    
    // Sync Board
    if(val.fen && val.fen!==game.fen() && val.fen !== 'start'){ 
        game.load(val.fen); 
        board.position(game.fen()); 
        updateStatus(); 
        playMoveSound();
        if(!timerStarted && val.status === 'playing') startTimer();
    }
    
    // Sync Result
    if(val.gameResult && gameActive) {
        finishGame("Online: " + val.gameResult);
    }
    
    // Sync Draw
    if(val.drawOffer && val.drawOffer !== playerColor) {
        if(confirm("Accept Draw?")) {
            pushGameEndToRoom(roomId, "Draw Agreed");
            roomRef.update({drawOffer:null});
        } else {
            roomRef.update({drawOffer:null});
            alert("Draw rejected");
        }
    }
  });
}

function pushMoveToRoom(id, fen, san){ 
    db.ref('rooms/'+id).update({ fen:fen, lastSan:san }); 
}
function pushGameEndToRoom(id, txt){ 
    db.ref('rooms/'+id).update({ gameResult:txt }); 
}
function pushDrawOffer(id, c){ 
    db.ref('rooms/'+id).update({ drawOffer:c }); 
}

// 7. STOCKFISH AI
async function ensureEngine(){
  if(engine && engineReady) return;
  engineReady = false;
  try {
      const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.0/stockfish.js');
      const b = new Blob([await response.text()], { type: 'application/javascript' });
      engine = new Worker(URL.createObjectURL(b));
  } catch(e) { 
      engine = null; 
      return; 
  }
  
  engine.onmessage = function(e){
    var line = e.data;
    if(line === 'uciok') engineReady = true;
    
    if(!isAnalysis && line.startsWith("bestmove")){
      let m = line.split(' ')[1];
      if(m && m !== '(none)'){
          game.move({ from: m.substring(0,2), to: m.substring(2,4), promotion:'q' });
          board.position(game.fen()); 
          isAiThinking = false; 
          updateStatus(); 
          playMoveSound();
          $('#aiStatus').text("");
      }
    }
    
    if(isAnalysis && typeof line==='string') {
        let sc = line.match(/score cp (-?\d+)/);
        let mt = line.match(/score mate (-?\d+)/);
        if(mt) {
            $('#evalScore').text("Mate in " + mt[1]);
        } else if(sc) {
            $('#evalScore').text((parseInt(sc[1])/100).toFixed(2));
        }
    }
  };
  engine.postMessage("uci");
}

function makeAiMove(){
    if(game.game_over() || !gameActive || !engine) return;
    isAiThinking = true;
    $('#aiStatus').text("AI is thinking...");
    
    if(!timerStarted) startTimer();
    
    const settings = { 
        1:{d:6,t:100}, 
        3:{d:10,t:300}, 
        5:{d:14,t:500}, 
        7:{d:25,t:2000} 
    }[aiDepth] || {d:10,t:300};
    
    engine.postMessage('ucinewgame');
    engine.postMessage('position fen ' + game.fen());
    
    if(aiDepth >= 6) {
        engine.postMessage('go movetime ' + settings.t);
    } else {
        engine.postMessage('go depth ' + settings.d);
    }
}
/* =========================================================================
   PART 3: UI ACTIONS, ANALYSIS, AND GAME OVER OVERLAY
   ========================================================================= */

// 8. MOVE HANDLERS (Drag & Drop - FIXED)
function onDragStart(source, piece){
  if(isAnalysis || game.game_over() || !gameActive || isAiThinking) return false;
  if(whiteTime<=0 || blackTime<=0) return false;
  
  // FIX: Cancel Tap Selection if dragging starts
  if(selectedSquare) { 
      selectedSquare = null; 
      removeHighlights(); 
  } 

  if(gameMode==='ai'){
    if((playerColor==='white' && piece.search(/^b/)!==-1) || (playerColor==='black' && piece.search(/^w/)!==-1)) return false;
  }
  
  if(gameMode.includes('online')) {
      if(playerColor === 'white' && game.turn() === 'b') return false;
      if(playerColor === 'black' && game.turn() === 'w') return false;
      if($status.text().includes("Searching")) return false;
  }
}

function onDrop(source, target){
  var move=game.move({from:source,to:target,promotion:'q'});
  if(move===null) return 'snapback';
  
  if(move.captured) playCaptureSound(); else playMoveSound();
  if(game.in_check()) playCheckSound();
  
  redoStack=[];
  if(!timerStarted) startTimer();
  updateStatus(); 
  updateTimerDisplay();
  board.position(game.fen());

  if(gameMode.includes('online') && currentRoomId){ 
      pushMoveToRoom(currentRoomId, game.fen(), move.san); 
  }

  if(gameMode === 'ai' && !game.game_over()) { 
      isAiThinking = true; 
      $status.text("AI is thinking..."); 
      setTimeout(makeAiMove, 250); 
  }
}
function onSnapEnd(){ board.position(game.fen()); }

// 9. TIMER LOGIC
function startTimer(){
  if(timerInterval) clearInterval(timerInterval);
  timerStarted=true;
  timerInterval=setInterval(()=>{
    if(!gameActive) return;
    if(game.turn()==='w'){
        whiteTime--;
        if(whiteTime<=0) endGameByTime('White');
    } else{
        blackTime--;
        if(blackTime<=0) endGameByTime('Black');
    }
    updateTimerDisplay();
  },1000);
}

function stopTimer(){ if(timerInterval) clearInterval(timerInterval); timerInterval=null; }

function endGameByTime(colorWhoLost){
  if(gameMode.includes('online')) {
      let winner = (colorWhoLost === 'White') ? 'Black' : 'White';
      pushGameEndToRoom(currentRoomId, `${winner} won on time`);
  } else {
      finishGame('Game Over! '+colorWhoLost+' ran out of time.');
  }
}

function updateTimerDisplay(){
  function formatTime(t){ if(t>99999) return "∞"; var min=Math.floor(t/60), s=t%60; return (min<10?"0"+min:min)+":"+(s<10?"0"+s:s); }
  $('#time-w').text(formatTime(whiteTime));
  $('#time-b').text(formatTime(blackTime));
  
  if(gameActive && timerStarted){ 
      if(game.turn()==='w'){
          $('#timer-white-container').addClass('active');
          $('#timer-black-container').removeClass('active');
      } else {
          $('#timer-black-container').addClass('active');
          $('#timer-white-container').removeClass('active');
      }
  } else {
      $('.timer-display').removeClass('active');
  }
}

// 10. UPDATED STATUS AND FINISH GAME
function updateStatus() {
  let status = '';
  let moveColor = (game.turn() === 'b') ? 'Black' : 'White';

  if (game.in_checkmate()) {
    let winner = (moveColor === 'White') ? 'Black' : 'White';
    if(gameMode.includes('online')){
        if(playerColor.charAt(0) === winner.charAt(0).toLowerCase())
           pushGameEndToRoom(currentRoomId, `${winner} Wins by Checkmate!`);
    } else {
        finishGame(`${winner} Wins by Checkmate!`);
        triggerBoardWinAnimation();
    }
    return;
  }

  if (game.in_draw()) {
    if(gameMode.includes('online')){
        pushGameEndToRoom(currentRoomId, "Draw (Stalemate)");
    } else {
        finishGame("Game Draw (Stalemate)");
        triggerBoardDrawAnimation();
    }
    return;
  }

  status = (!timerStarted) ? "Waiting..." : `${moveColor} to move${game.in_check() ? " (CHECK!)" : ""}`;
  $status.text(status);
}

function finishGame(reasonText) {
    gameActive = false;
    stopTimer();
    $status.text(reasonText);
    playGameOverSound();
    showEndGame(reasonText);
    $('#analyzeBtn').show();
}

// 11. GAME OVER OVERLAY
function showEndGame(result) {
    let ov = document.getElementById("end-game-overlay");
    if (!ov) {
        ov = document.createElement('div'); ov.id = 'end-game-overlay'; ov.className = 'hidden';
        ov.innerHTML = `
            <div id="end-game-text" class="message"></div>
            <span style="font-size: 2rem;">🎉 Game Over</span>
            <div style="display:flex;gap:15px;justify-content:center;margin-top:20px;">
                <button id="ov-an" style="padding:15px 25px;background:#4a90e2;color:white;border:none;border-radius:8px;cursor:pointer;">🔍 Analyze</button>
                <button id="ov-me" style="padding:15px 25px;background:#2ecc71;color:white;border:none;border-radius:8px;cursor:pointer;">🏠 Main Menu</button>
            </div>`;
        document.body.appendChild(ov);
        document.getElementById('ov-an').onclick = startAnalysis;
        document.getElementById('ov-me').onclick = () => location.reload();
    }
    document.getElementById("end-game-text").textContent = result;
    ov.classList.remove('win','lose','draw');
    if (result.toLowerCase().includes('draw')) ov.classList.add('draw');
    else if (result.toLowerCase().includes(playerColor)) ov.classList.add('lose');
    else ov.classList.add('win');
    
    ov.style.display="flex"; ov.style.pointerEvents="auto"; ov.classList.remove("hidden"); ov.classList.add("show");
}

// 12. ANALYSIS & BINDINGS
$('#analyzeBtn').click(startAnalysis);

function startAnalysis(){ 
    $('#end-game-overlay').hide(); 
    isAnalysis=true; 
    gameActive=false; 
    stopTimer(); 
    analysisHistory=game.history({verbose:true}); 
    analysisIndex=analysisHistory.length-1; 
    $('#gameSettings').hide(); 
    $('#inGameControls').hide(); 
    $('#analysisControls').show(); 
    ensureEngine(); 
    updateAnalysisBoard(); 
}

$('#exitAnalysisBtn').click(() => { 
    $('#analysisControls').hide(); 
    $('#gameSettings').show(); 
});

$('#anPrev').click(()=>{ if(analysisIndex>=-1)analysisIndex--; updateAnalysisBoard(); });
$('#anNext').click(()=>{ if(analysisIndex<analysisHistory.length-1)analysisIndex++; updateAnalysisBoard(); });

function updateAnalysisBoard(){ 
    var g=new Chess(); 
    for(var i=0;i<=analysisIndex;i++) g.move(analysisHistory[i]); 
    board.position(g.fen()); 
    removeHighlights(); 
    if(engine){ 
        engine.postMessage('position fen '+g.fen()); 
        engine.postMessage('go depth 15'); 
    } 
}

$('#undoBtn').click(()=>{ 
    if(gameMode!=='ai'||!gameActive||isAiThinking)return; 
    var m=game.undo(); 
    if(m){
        redoStack.push(m); 
        if(gameMode==='ai')redoStack.push(game.undo()); 
        board.position(game.fen());
    } 
});

$('#redoBtn').click(()=>{ 
    if(gameMode!=='ai'||!gameActive||!redoStack.length)return; 
    game.move(redoStack.pop()); 
    if(gameMode==='ai')game.move(redoStack.pop()); 
    board.position(game.fen()); 
});

$('#resignBtn').click(()=>{ 
    if(gameActive && confirm("Resign?")) { 
        if(gameMode.includes('online')) pushGameEndToRoom(currentRoomId, "Resignation"); 
        else finishGame("Resigned"); 
    } 
});

$('#drawBtn').click(()=>{ 
    if(gameActive && gameMode.includes('online')) { 
        pushDrawOffer(currentRoomId, playerColor); 
        alert("Sent"); 
    } 
});

document.getElementById("difficulty").addEventListener("change", function(){ 
    aiDepth=Number(this.value); 
    if(gameMode==='ai') checkDeathMode(aiDepth); 
});

function checkDeathMode(l){ 
    if(l===7){
        $('#death-warning').show(); 
        playDeathModeSound(); 
        document.body.style.background="black";
    } else {
        $('#death-warning').hide(); 
        document.body.style.background="#212121";
    } 
}

function triggerBoardWinAnimation(){ 
    $('#myBoard').addClass('winner-animation'); 
    setTimeout(()=>$('#myBoard').removeClass('winner-animation'),4000); 
}

function triggerBoardDrawAnimation(){ 
    $('#myBoard').addClass('draw-animation'); 
    setTimeout(()=>$('#myBoard').removeClass('draw-animation'),3000); 
}

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

// 13. FINAL BIND (With Click Listener for Tap-to-Move)
$(document).ready(function(){
  
  var config = { 
      position: 'start', 
      pieceTheme: 'assets/pieces/{piece}.png',
      draggable: true,
      onDragStart: onDragStart,
      onDrop: onDrop,
      onMouseoutSquare: onMouseoutSquare,
      onMouseoverSquare: onMouseoverSquare,
      onSnapEnd: onSnapEnd
  };
  
  board = Chessboard('myBoard', config);
  $('#inGameControls').hide();

  // BIND TAP EVENT
  $('#myBoard').on('click', '.square-55d63', function() {
      var square = $(this).attr('data-square');
      handleSquareClick(square);
  });
});
